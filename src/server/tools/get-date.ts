import { z } from 'zod';

import { config } from '../config.ts';
import { failure, type Tool, type ToolResult } from './types.ts';

// Deliberately permissive: local models emit `null`, `""` and omitted arguments
// interchangeably for an optional field, and none of those deserve an error.
const argsSchema = z.object({
  timezone: z.string().max(64).nullish(),
});

/** `Intl` throws on an unknown zone, which is the only dependency-free way to validate one. */
function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const getDate: Tool = {
  name: 'get_date',
  description:
    "Get the current date and time, including the day of the week. Accepts an optional IANA timezone; defaults to the operator's own timezone.",
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description:
          'Optional IANA timezone name, for example "Europe/Berlin", "America/New_York", "Asia/Tokyo" or "UTC". Omit it for the operator\'s local time.',
      },
    },
    required: [],
  },
  guidance:
    '`get_date(timezone?)` — the current date and time. Use it for anything relative ("today", "next Friday", "how long until…"); your training data cannot tell you what day it is. Pass an IANA timezone such as "Asia/Tokyo" when asked about another region, and omit it for local time.',

  run(rawArgs: unknown): Promise<ToolResult> {
    const parsed = argsSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return Promise.resolve(
        failure(
          'Invalid timezone argument',
          'The `timezone` argument must be an IANA timezone name such as "Europe/Berlin". Omit it for local time.',
        ),
      );
    }

    const requested = parsed.data.timezone?.trim();
    const zone = requested !== undefined && requested !== '' ? requested : config.timezone;

    if (!isKnownZone(zone)) {
      return Promise.resolve(
        failure(
          `Unknown timezone "${zone}"`,
          `"${zone}" is not a recognised IANA timezone. Use a name like "Europe/Berlin", "America/New_York", "Asia/Tokyo" or "UTC", then try again.`,
        ),
      );
    }

    const now = new Date();
    // Locale is pinned rather than inherited: a container's locale is unpredictable, and the
    // 24-hour rendering is unambiguous to the model in a way that a bare "1:04" is not.
    const formatted = now.toLocaleString('en-GB', {
      timeZone: zone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    return Promise.resolve({
      ok: true,
      summary: `${formatted} · ${zone}`,
      // The ISO stamp is always UTC, giving one unambiguous anchor beside the local rendering.
      content: `Current date and time in ${zone}: ${formatted}. UTC equivalent: ${now.toISOString()}.`,
    });
  },
};
