import type { Tool } from './types.ts';

export const getDate: Tool = {
  name: 'get_date',
  description:
    "Get the current date and time on the operator's machine, including the day of the week and timezone.",
  parameters: { type: 'object', properties: {}, required: [] },
  guidance:
    '`get_date()` — the current date and time. Use it for anything relative ("today", "next Friday", "how long until…"); your training data cannot tell you what day it is.',

  run(): Promise<{ ok: boolean; summary: string; content: string }> {
    const now = new Date();
    const formatted = now.toLocaleString(undefined, {
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
      summary: formatted,
      content: `Current local date and time: ${formatted} (ISO: ${now.toISOString()}).`,
    });
  },
};
