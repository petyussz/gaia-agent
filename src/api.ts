import { readNdjson } from './shared/ndjson.ts';
import type {
  HealthResponse,
  ModelsResponse,
  TelemetryFrame,
  TurnEvent,
} from './shared/protocol.ts';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `${path} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export interface AuthStatus {
  readonly authRequired: boolean;
  readonly authenticated: boolean;
}

export function getAuthStatus(): Promise<AuthStatus> {
  return json<AuthStatus>('/api/auth/status');
}

export function login(token: string): Promise<{ ok: boolean }> {
  return json<{ ok: boolean }>('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export function getHealth(): Promise<HealthResponse> {
  return json<HealthResponse>('/api/health');
}

export function getModels(): Promise<ModelsResponse> {
  return json<ModelsResponse>('/api/models');
}

export function resetSession(): Promise<{ ok: boolean }> {
  return json<{ ok: boolean }>('/api/session/reset', { method: 'POST' });
}

/**
 * Streams one turn, invoking `onEvent` for each NDJSON frame as it arrives.
 *
 * `EventSource` cannot be used here because it only issues GET requests with no body, so the
 * stream is read manually from the response body instead.
 */
export async function streamTurn(
  prompt: string,
  model: string,
  onEvent: (event: TurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/turn', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, model }),
    signal,
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `Turn failed (${response.status}).`);
  }
  if (!response.body) throw new Error('No response stream.');

  for await (const event of readNdjson<TurnEvent>(response.body)) onEvent(event);
}

/** Telemetry is a GET with no body, so `EventSource` fits — and brings reconnection for free. */
export function subscribeTelemetry(onFrame: (frame: TelemetryFrame) => void): () => void {
  const source = new EventSource('/api/telemetry/stream', { withCredentials: true });

  source.onmessage = (event: MessageEvent<string>) => {
    try {
      onFrame(JSON.parse(event.data) as TelemetryFrame);
    } catch {
      // A malformed frame is not worth tearing the connection down for.
    }
  };

  return () => source.close();
}
