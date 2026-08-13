/**
 * Wire types shared by the server and the browser.
 *
 * Two streams, two transports, for a reason:
 *  - `/api/turn` is a POST with a body, so it cannot use `EventSource`. It streams NDJSON and is
 *    read with a `fetch` + `ReadableStream` reader.
 *  - `/api/telemetry/stream` is a GET with no body, so `EventSource` fits and brings automatic
 *    reconnection for free.
 */

// ── Turn stream (NDJSON, server → browser) ───────────────────────────────────────────────────

/** A tool invocation as surfaced to the UI. Arguments are echoed for the trace card. */
export interface ToolCallView {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export type TurnEvent =
  /** A slice of assistant prose. Append verbatim. */
  | { readonly type: 'token'; readonly delta: string }
  /**
   * Discard the prose streamed since the last commit point.
   *
   * Local models occasionally emit a sentence *and* a tool call in the same reply. The prose is
   * a preamble to work that has not happened yet ("Let me check the weather..."), so it is
   * retracted rather than left stranded above the real answer.
   */
  | { readonly type: 'rollback' }
  | { readonly type: 'tool_start'; readonly call: ToolCallView }
  | {
      readonly type: 'tool_end';
      readonly id: string;
      readonly ok: boolean;
      /** Short human-readable outcome. Never the full payload. */
      readonly summary: string;
    }
  | { readonly type: 'done'; readonly text: string }
  | { readonly type: 'error'; readonly message: string };

export interface TurnRequest {
  readonly prompt: string;
  readonly model: string;
}

// ── Telemetry (SSE, server → browser) ────────────────────────────────────────────────────────

export interface CpuTelemetry {
  /** 0–100, host-wide. Absent on the first sample: a percentage needs two readings to exist. */
  readonly usage: number;
  readonly cores: number;
  readonly load1: number;
}

export interface MemoryTelemetry {
  readonly usedBytes: number;
  readonly totalBytes: number;
}

/**
 * VRAM as reported by Ollama for resident models.
 *
 * This is *allocation*, not utilisation — Ollama does not expose GPU busy percentage or
 * temperature. `utilisation` and `temperature` stay optional so an `nvidia-smi` source can be
 * added later without touching the client.
 */
export interface GpuTelemetry {
  readonly vramBytes: number;
  readonly modelBytes: number;
  /** vramBytes / modelBytes — 1 means fully offloaded to GPU. */
  readonly offloadRatio: number;
  readonly utilisation?: number;
  readonly temperature?: number;
}

export interface ModelTelemetry {
  readonly name: string;
  /** Epoch ms at which Ollama unloads the model, or null if it does not expire. */
  readonly expiresAt: number | null;
}

export interface TelemetryFrame {
  readonly ts: number;
  readonly ollamaOnline: boolean;
  readonly ollamaVersion: string | null;
  readonly cpu: CpuTelemetry | null;
  readonly memory: MemoryTelemetry | null;
  /** null = no GPU-resident model, so the UI omits the row entirely. */
  readonly gpu: GpuTelemetry | null;
  readonly model: ModelTelemetry | null;
}

// ── Plain JSON endpoints ─────────────────────────────────────────────────────────────────────

export interface ModelInfo {
  readonly id: string;
  readonly label: string;
  /** False when Ollama does not advertise the `tools` capability for this model. */
  readonly supportsTools: boolean;
}

export interface ModelsResponse {
  readonly models: readonly ModelInfo[];
  readonly active: string;
}

export interface HealthResponse {
  readonly ok: true;
  readonly ollamaOnline: boolean;
  readonly authRequired: boolean;
  /** Names only — never key material. */
  readonly tools: readonly string[];
}
