import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

import { config } from './config.ts';
import type { OllamaMessage, OllamaToolCall } from './ollama.ts';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredMessage {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly OllamaToolCall[];
}

interface Session {
  readonly id: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

const sessions = new Map<string, Session>();

// ── Persistence ──────────────────────────────────────────────────────────────────────────────

function load(): void {
  try {
    const raw = readFileSync(config.sessionFile, 'utf8');
    const parsed = JSON.parse(raw) as readonly Session[];
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const session of parsed) {
      if (session.updatedAt < cutoff) continue;
      sessions.set(session.id, session);
    }
  } catch {
    // No store yet, or an unreadable one. Starting empty is the correct recovery.
  }
}

let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      // Write-then-rename: a crash mid-write leaves the previous good file intact rather than
      // a truncated one that would fail to parse on next boot.
      const temporary = `${config.sessionFile}.tmp`;
      writeFileSync(temporary, JSON.stringify([...sessions.values()]), 'utf8');
      renameSync(temporary, config.sessionFile);
    } catch (error) {
      console.warn('[session] Could not persist sessions:', (error as Error).message);
    }
  }, 1_000);
  flushTimer.unref();
}

load();

// ── Window trimming ──────────────────────────────────────────────────────────────────────────

/**
 * Keeps at most `limit` recent messages, then discards from the front until the window starts
 * on a `user` message.
 *
 * That second step is load-bearing: a naive slice can leave a `tool` result, or an assistant
 * turn that requested tools, as the first message. Ollama rejects a tool result with no
 * preceding call, so the trim must snap to a clean turn boundary rather than a message count.
 */
export function trimHistory(
  messages: readonly StoredMessage[],
  limit: number,
): readonly StoredMessage[] {
  const recent = messages.length > limit ? messages.slice(messages.length - limit) : messages;

  let start = 0;
  while (start < recent.length && recent[start]?.role !== 'user') start += 1;

  // Every message belonged to one unfinished exchange; dropping the lot beats sending a
  // malformed one.
  return start >= recent.length ? [] : recent.slice(start);
}

// ── Public API ───────────────────────────────────────────────────────────────────────────────

export function createSessionId(): string {
  return randomUUID();
}

function ensure(id: string): Session {
  const existing = sessions.get(id);
  if (existing) return existing;

  const created: Session = { id, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  sessions.set(id, created);
  return created;
}

export function history(id: string): readonly StoredMessage[] {
  const session = sessions.get(id);
  if (!session) return [];
  return trimHistory(session.messages, config.historyWindow);
}

export function append(id: string, messages: readonly StoredMessage[]): void {
  const session = ensure(id);
  session.messages.push(...messages);
  session.updatedAt = Date.now();

  // Bound the on-disk copy too, so a long-lived session cannot grow without limit.
  const hardLimit = config.historyWindow * 4;
  if (session.messages.length > hardLimit) {
    session.messages = [...trimHistory(session.messages, hardLimit)];
  }

  scheduleFlush();
}

export function reset(id: string): void {
  sessions.delete(id);
  scheduleFlush();
}

/** Converts stored history into the wire shape Ollama expects. */
export function toOllamaMessages(messages: readonly StoredMessage[]): OllamaMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolName === undefined ? {} : { tool_name: message.toolName }),
    ...(message.toolCalls === undefined ? {} : { tool_calls: message.toolCalls }),
  }));
}
