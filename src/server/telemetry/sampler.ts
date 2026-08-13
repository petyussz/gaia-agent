import type { TelemetryFrame } from '../../shared/protocol.ts';
import { getVersion, listResident } from '../ollama.ts';
import { readCpu, readMemory } from './proc.ts';

const PROC_INTERVAL_MS = 2_000;
/** Resident models change on the order of minutes, so polling them at the /proc rate is waste. */
const OLLAMA_INTERVAL_MS = 10_000;

type Listener = (frame: TelemetryFrame) => void;

const listeners = new Set<Listener>();
let procTimer: NodeJS.Timeout | null = null;
let ollamaTimer: NodeJS.Timeout | null = null;

let ollamaOnline = false;
let ollamaVersion: string | null = null;
let gpu: TelemetryFrame['gpu'] = null;
let model: TelemetryFrame['model'] = null;

async function pollOllama(): Promise<void> {
  ollamaVersion = await getVersion();
  ollamaOnline = ollamaVersion !== null;

  if (!ollamaOnline) {
    gpu = null;
    model = null;
    return;
  }

  try {
    const resident = await listResident();
    // Largest resident model is the one the operator is actually talking to; showing several
    // rows for background loads would be noise.
    const primary = [...resident].sort((a, b) => b.size - a.size)[0];

    if (!primary) {
      gpu = null;
      model = null;
      return;
    }

    model = { name: primary.name, expiresAt: primary.expiresAt };

    // Zero VRAM means the model is running on CPU — so there is no GPU worth reporting, and
    // the UI drops the row entirely. This *is* the GPU detection: no probe, no nvidia-smi.
    gpu =
      primary.sizeVram > 0
        ? {
            vramBytes: primary.sizeVram,
            modelBytes: primary.size,
            offloadRatio: primary.size > 0 ? primary.sizeVram / primary.size : 0,
          }
        : null;
  } catch {
    gpu = null;
    model = null;
  }
}

async function emit(): Promise<void> {
  if (listeners.size === 0) return;

  const [cpu, memory] = await Promise.all([readCpu(), readMemory()]);
  const frame: TelemetryFrame = {
    ts: Date.now(),
    ollamaOnline,
    ollamaVersion,
    cpu,
    memory,
    gpu,
    model,
  };

  for (const listener of listeners) listener(frame);
}

function start(): void {
  if (procTimer !== null) return;

  void pollOllama().then(() => emit());

  procTimer = setInterval(() => void emit(), PROC_INTERVAL_MS);
  ollamaTimer = setInterval(() => void pollOllama(), OLLAMA_INTERVAL_MS);
  procTimer.unref();
  ollamaTimer.unref();
}

function stop(): void {
  if (procTimer !== null) clearInterval(procTimer);
  if (ollamaTimer !== null) clearInterval(ollamaTimer);
  procTimer = null;
  ollamaTimer = null;
}

/**
 * One sampler serves every connected client.
 *
 * Per-connection timers would mean N processes polling Ollama and re-reading procfs for
 * identical data; the refcount also stops all work once the last tab closes.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  start();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}
