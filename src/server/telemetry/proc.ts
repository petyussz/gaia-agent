import { readFile } from 'node:fs/promises';

import type { CpuTelemetry, MemoryTelemetry } from '../../shared/protocol.ts';

/**
 * Host CPU and memory, read from procfs.
 *
 * Inside a container `/proc/stat` and `/proc/meminfo` report the *host*, not the container —
 * procfs is not namespaced for these. That is exactly what is wanted here: the interesting
 * number is what the machine running Ollama is doing, not what this small Node process is doing.
 *
 * Parsing is kept separate from I/O so it can be tested against real procfs samples on any
 * platform, including the Windows machine this is developed on.
 */

export interface CpuSample {
  readonly total: number;
  readonly idle: number;
  readonly cores: number;
}

export function parseCpuStat(raw: string): CpuSample | null {
  const lines = raw.split('\n');
  const aggregate = lines.find((line) => line.startsWith('cpu '));
  if (!aggregate) return null;

  const fields = aggregate.trim().split(/\s+/).slice(1).map(Number);
  if (fields.length < 5 || fields.some((value) => !Number.isFinite(value))) return null;

  return {
    total: fields.reduce((sum, value) => sum + value, 0),
    // idle + iowait: a core blocked on I/O is not doing work, and counting it as busy would make
    // an idle-but-swapping machine look pegged.
    idle: (fields[3] ?? 0) + (fields[4] ?? 0),
    cores: lines.filter((line) => /^cpu\d+ /.test(line)).length,
  };
}

/** Returns 0–100, or null when the two samples cannot yield a rate. */
export function cpuUsage(previous: CpuSample, next: CpuSample): number | null {
  const totalDelta = next.total - previous.total;
  if (totalDelta <= 0) return null;

  const idleDelta = next.idle - previous.idle;
  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.round(Math.min(100, Math.max(0, usage)) * 10) / 10;
}

export function parseMemInfo(raw: string): MemoryTelemetry | null {
  const values = new Map<string, number>();
  for (const line of raw.split('\n')) {
    const match = /^(\w+):\s+(\d+)\s+kB$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      values.set(match[1], Number(match[2]) * 1024);
    }
  }

  const total = values.get('MemTotal');
  // MemAvailable, not MemFree: MemFree excludes reclaimable page cache, so a healthy Linux box
  // with a warm cache would look like it is nearly out of memory.
  const available = values.get('MemAvailable');
  if (total === undefined || available === undefined) return null;

  return { usedBytes: total - available, totalBytes: total };
}

export function parseLoadAvg(raw: string): number {
  const first = Number(raw.trim().split(/\s+/)[0]);
  return Number.isFinite(first) ? first : 0;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    // Not Linux, or procfs is not mounted. The metric is simply unavailable and the UI omits it.
    return null;
  }
}

let previous: CpuSample | null = null;

export async function readCpu(): Promise<CpuTelemetry | null> {
  const raw = await readOrNull('/proc/stat');
  if (raw === null) return null;

  const sample = parseCpuStat(raw);
  if (sample === null) return null;

  const last = previous;
  previous = sample;

  // A percentage is a rate, and a rate needs two readings. The first call legitimately has no
  // answer — reporting 0 here would be a lie that looks like data.
  if (last === null) return null;

  const usage = cpuUsage(last, sample);
  if (usage === null) return null;

  const loadRaw = await readOrNull('/proc/loadavg');
  return {
    usage,
    cores: sample.cores,
    load1: loadRaw === null ? 0 : parseLoadAvg(loadRaw),
  };
}

export async function readMemory(): Promise<MemoryTelemetry | null> {
  const raw = await readOrNull('/proc/meminfo');
  return raw === null ? null : parseMemInfo(raw);
}
