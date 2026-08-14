import { describe, expect, it } from 'vitest';

import { config } from '../config.ts';
import { getDate } from './get-date.ts';
import type { ToolContext } from './types.ts';

const ctx: ToolContext = { signal: new AbortController().signal };

describe('get_date', () => {
  it('falls back to the configured timezone when none is given', async () => {
    const result = await getDate.run({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain(config.timezone);
  });

  it('honours an explicit timezone', async () => {
    const tokyo = await getDate.run({ timezone: 'Asia/Tokyo' }, ctx);
    const utc = await getDate.run({ timezone: 'UTC' }, ctx);

    expect(tokyo.ok).toBe(true);
    expect(tokyo.content).toContain('Asia/Tokyo');
    // Tokyo is never at the same wall-clock time as UTC, so the renderings must differ —
    // this is what proves the timeZone option is actually being applied.
    expect(tokyo.summary).not.toEqual(utc.summary);
  });

  it('treats null, empty and whitespace as "not specified"', async () => {
    for (const timezone of [null, undefined, '', '   ']) {
      const result = await getDate.run({ timezone }, ctx);
      expect(result.ok).toBe(true);
      expect(result.content).toContain(config.timezone);
    }
  });

  it('rejects an unknown zone with a message the model can recover from', async () => {
    const result = await getDate.run({ timezone: 'Middle/Earth' }, ctx);
    expect(result.ok).toBe(false);
    // The correction has to carry usable examples, or the model just retries the same value.
    expect(result.content).toContain('Europe/Berlin');
  });

  it('always includes a UTC anchor alongside the local rendering', async () => {
    const result = await getDate.run({ timezone: 'Asia/Tokyo' }, ctx);
    expect(result.content).toMatch(/UTC equivalent: \d{4}-\d{2}-\d{2}T[\d:.]+Z/);
  });
});
