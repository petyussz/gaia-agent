import { z } from 'zod';

import { config } from '../config.ts';
import { failure, fenceUntrusted, type Tool, type ToolContext, type ToolResult } from './types.ts';

// Bounded and character-restricted: the value is interpolated into an outbound URL, so it must
// not be able to smuggle path segments, query parameters or control characters.
const argsSchema = z.object({
  location: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\p{L}\p{N} ,.'\-+]+$/u, 'Location contains unsupported characters.'),
});

interface WttrResponse {
  readonly current_condition?: readonly {
    readonly temp_C?: string;
    readonly FeelsLikeC?: string;
    readonly humidity?: string;
    readonly windspeedKmph?: string;
    readonly winddir16Point?: string;
    readonly weatherDesc?: readonly { readonly value?: string }[];
  }[];
  readonly nearest_area?: readonly {
    readonly areaName?: readonly { readonly value?: string }[];
    readonly country?: readonly { readonly value?: string }[];
  }[];
  readonly weather?: readonly {
    readonly date?: string;
    readonly maxtempC?: string;
    readonly mintempC?: string;
  }[];
}

export const getWeather: Tool = {
  name: 'get_weather',
  description:
    'Get the current weather and today\'s forecast for a place, by city name, region or postal code.',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City, region or postal code. For example "Budapest" or "Berlin, Germany".',
      },
    },
    required: ['location'],
  },
  guidance:
    '`get_weather(location)` — current conditions and today\'s range for a place. Always call it rather than guessing; you have no weather knowledge of your own.',

  async run(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return failure(
        'Invalid location',
        'The `location` argument must be a plain place name of 1–64 characters. Try again with a simple city name.',
      );
    }

    const { location } = parsed.data;
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;

    let payload: WttrResponse;
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'gaia-agent/0.1', accept: 'application/json' },
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(config.toolTimeoutMs)]),
      });
      if (!response.ok) {
        return failure(
          `Weather lookup failed (${response.status})`,
          `wttr.in could not resolve "${location}". Ask the operator for a more specific place name.`,
        );
      }
      payload = (await response.json()) as WttrResponse;
    } catch {
      return failure(
        'Weather service unreachable',
        'The weather service did not respond. Say so plainly; do not invent a forecast.',
      );
    }

    const current = payload.current_condition?.[0];
    if (!current) {
      return failure(
        'No weather data',
        `No conditions were returned for "${location}". Do not guess a forecast.`,
      );
    }

    const area = payload.nearest_area?.[0];
    const place =
      [area?.areaName?.[0]?.value, area?.country?.[0]?.value].filter(Boolean).join(', ') || location;
    const description = current.weatherDesc?.[0]?.value ?? 'unknown conditions';
    const today = payload.weather?.[0];

    const parts = [
      `${place}: ${description}, ${current.temp_C ?? '?'}°C (feels like ${current.FeelsLikeC ?? '?'}°C)`,
      `humidity ${current.humidity ?? '?'}%`,
      `wind ${current.windspeedKmph ?? '?'} km/h ${current.winddir16Point ?? ''}`.trim(),
    ];
    if (today) parts.push(`today ${today.mintempC ?? '?'}°C to ${today.maxtempC ?? '?'}°C`);

    const body = parts.join(', ');
    return {
      ok: true,
      summary: `${place} · ${current.temp_C ?? '?'}°C · ${description}`,
      content: fenceUntrusted('wttr.in', body),
    };
  },
};
