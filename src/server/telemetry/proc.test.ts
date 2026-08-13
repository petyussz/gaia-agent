import { describe, expect, it } from 'vitest';

import { cpuUsage, parseCpuStat, parseLoadAvg, parseMemInfo } from './proc.ts';

// Real /proc/stat output from a 4-core Linux host.
const STAT = `cpu  197061 1088 51938 3624810 5299 0 3162 0 0 0
cpu0 49946 268 13369 905447 1394 0 1522 0 0 0
cpu1 48944 279 12684 907362 1289 0 604 0 0 0
cpu2 49327 261 12905 906291 1310 0 528 0 0 0
cpu3 48843 279 12979 905709 1305 0 507 0 0 0
intr 25889766 0 9 0 0 0
ctxt 60419895
btime 1786500000
`;

const MEMINFO = `MemTotal:       65742416 kB
MemFree:         1284376 kB
MemAvailable:   48210984 kB
Buffers:          204812 kB
Cached:         44120392 kB
SwapCached:            0 kB
`;

describe('parseCpuStat', () => {
  it('sums all fields and counts cores', () => {
    const sample = parseCpuStat(STAT);
    expect(sample).not.toBeNull();
    expect(sample?.cores).toBe(4);
    expect(sample?.total).toBe(197061 + 1088 + 51938 + 3624810 + 5299 + 0 + 3162 + 0 + 0 + 0);
  });

  it('counts iowait as idle, not busy', () => {
    // idle (3624810) + iowait (5299)
    expect(parseCpuStat(STAT)?.idle).toBe(3630109);
  });

  it('returns null on unparseable input', () => {
    expect(parseCpuStat('')).toBeNull();
    expect(parseCpuStat('nonsense\n')).toBeNull();
    expect(parseCpuStat('cpu  1 2\n')).toBeNull();
  });
});

describe('cpuUsage', () => {
  const base = { total: 1000, idle: 800, cores: 4 };

  it('computes the busy percentage between two samples', () => {
    // 100 more ticks total, 75 of them idle => 25% busy.
    expect(cpuUsage(base, { total: 1100, idle: 875, cores: 4 })).toBe(25);
  });

  it('reports zero when the machine was entirely idle', () => {
    expect(cpuUsage(base, { total: 1100, idle: 900, cores: 4 })).toBe(0);
  });

  it('reports 100 when fully busy', () => {
    expect(cpuUsage(base, { total: 1100, idle: 800, cores: 4 })).toBe(100);
  });

  it('returns null rather than a bogus number when no time has passed', () => {
    expect(cpuUsage(base, base)).toBeNull();
  });

  it('clamps a counter reset instead of producing a negative or >100 value', () => {
    const usage = cpuUsage(base, { total: 1100, idle: 700, cores: 4 });
    expect(usage).toBeGreaterThanOrEqual(0);
    expect(usage).toBeLessThanOrEqual(100);
  });
});

describe('parseMemInfo', () => {
  it('uses MemAvailable rather than MemFree', () => {
    const memory = parseMemInfo(MEMINFO);
    expect(memory).not.toBeNull();
    expect(memory?.totalBytes).toBe(65742416 * 1024);
    // Using MemFree would report ~64 GB used on a machine that has 48 GB genuinely available.
    expect(memory?.usedBytes).toBe((65742416 - 48210984) * 1024);
  });

  it('returns null when MemAvailable is absent', () => {
    expect(parseMemInfo('MemTotal:  100 kB\nMemFree:  50 kB\n')).toBeNull();
  });
});

describe('parseLoadAvg', () => {
  it('reads the one-minute average', () => {
    expect(parseLoadAvg('0.52 0.58 0.59 1/1234 5678\n')).toBe(0.52);
  });

  it('falls back to zero on garbage', () => {
    expect(parseLoadAvg('')).toBe(0);
  });
});
