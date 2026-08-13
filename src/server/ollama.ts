import type { ModelInfo } from '../shared/protocol.ts';
import { readNdjson } from '../shared/ndjson.ts';
import { config } from './config.ts';

// ── Wire shapes ──────────────────────────────────────────────────────────────────────────────

export interface OllamaToolCall {
  readonly function?: {
    readonly name?: string;
    /** Ollama sends an object here, unlike OpenAI which sends a JSON string. */
    readonly arguments?: Record<string, unknown>;
  };
}

export interface OllamaMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly tool_name?: string;
  readonly tool_calls?: readonly OllamaToolCall[];
}

export interface OllamaChatChunk {
  readonly message?: {
    readonly role?: string;
    readonly content?: string;
    readonly tool_calls?: readonly OllamaToolCall[];
  };
  readonly done?: boolean;
  readonly error?: string;
}

export interface ToolSchema {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface ResidentModel {
  readonly name: string;
  readonly size: number;
  readonly sizeVram: number;
  readonly expiresAt: number | null;
}

// ── Fetch plumbing ───────────────────────────────────────────────────────────────────────────

function timeoutSignal(ms: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return external ? AbortSignal.any([timeout, external]) : timeout;
}

async function ollamaFetch(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(`${config.ollamaUrl}${path}`, {
    ...init,
    signal: timeoutSignal(timeoutMs, signal),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Ollama ${path} failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  return response;
}

// ── Capability probe ─────────────────────────────────────────────────────────────────────────

/**
 * Capabilities are a property of the model tag and never change for a given tag, so probing
 * once and caching for the process lifetime is safe — and avoids N extra requests every time
 * the model list is refreshed.
 */
const capabilityCache = new Map<string, boolean>();

async function supportsTools(model: string): Promise<boolean> {
  const cached = capabilityCache.get(model);
  if (cached !== undefined) return cached;

  let result = true;
  try {
    const response = await ollamaFetch(
      '/api/show',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
      },
      10_000,
    );
    const payload = (await response.json()) as { capabilities?: readonly string[] };
    // Older Ollama builds omit `capabilities` entirely. Absence is not evidence of absence, so
    // assume support rather than greying out every model on an older server.
    if (Array.isArray(payload.capabilities)) {
      result = payload.capabilities.includes('tools');
    }
  } catch {
    result = true;
  }

  capabilityCache.set(model, result);
  return result;
}

// ── Public API ───────────────────────────────────────────────────────────────────────────────

export async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const response = await ollamaFetch('/api/tags', {}, 10_000, signal);
  const payload = (await response.json()) as {
    models?: readonly {
      name?: string;
      details?: { parameter_size?: string; quantization_level?: string };
    }[];
  };

  const names: { id: string; label: string }[] = [];
  for (const entry of payload.models ?? []) {
    const id = entry.name?.trim();
    if (!id) continue;
    const suffix = [entry.details?.parameter_size, entry.details?.quantization_level]
      .filter(Boolean)
      .join(' · ');
    names.push({ id, label: suffix ? `${id} (${suffix})` : id });
  }

  names.sort((a, b) => a.id.localeCompare(b.id));

  return Promise.all(
    names.map(async (entry) => ({
      id: entry.id,
      label: entry.label,
      supportsTools: await supportsTools(entry.id),
    })),
  );
}

export async function getVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await ollamaFetch('/api/version', {}, 5_000, signal);
    const payload = (await response.json()) as { version?: string };
    return payload.version ?? null;
  } catch {
    return null;
  }
}

export async function listResident(signal?: AbortSignal): Promise<ResidentModel[]> {
  const response = await ollamaFetch('/api/ps', {}, 5_000, signal);
  const payload = (await response.json()) as {
    models?: readonly {
      name?: string;
      size?: number;
      size_vram?: number;
      expires_at?: string;
    }[];
  };

  const resident: ResidentModel[] = [];
  for (const entry of payload.models ?? []) {
    const name = entry.name?.trim();
    if (!name) continue;

    const expiry = entry.expires_at ? Date.parse(entry.expires_at) : Number.NaN;
    resident.push({
      name,
      size: entry.size ?? 0,
      sizeVram: entry.size_vram ?? 0,
      expiresAt: Number.isFinite(expiry) ? expiry : null,
    });
  }
  return resident;
}

export interface ChatOptions {
  readonly model: string;
  readonly messages: readonly OllamaMessage[];
  readonly tools?: readonly ToolSchema[];
  readonly signal?: AbortSignal;
}

/**
 * Streams one `/api/chat` completion as raw Ollama chunks.
 *
 * Deliberately dumb: it does not interpret tool calls or accumulate text. The turn loop owns
 * that policy, which keeps this module a thin, testable transport.
 */
export async function* streamChat(options: ChatOptions): AsyncGenerator<OllamaChatChunk> {
  const response = await ollamaFetch(
    '/api/chat',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        // Reasoning tokens are for the model, not the operator. They would otherwise stream
        // straight into the transcript.
        think: false,
        keep_alive: '10m',
        ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
      }),
    },
    config.requestTimeoutMs,
    options.signal,
  );

  if (!response.body) throw new Error('Ollama returned no response body.');

  for await (const chunk of readNdjson<OllamaChatChunk>(response.body)) {
    if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
    yield chunk;
  }
}
