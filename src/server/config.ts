import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(name: string, fallback: readonly string[]): readonly string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const dataDir = resolve(str('GAIA_DATA_DIR', './data'));
mkdirSync(dataDir, { recursive: true });

export const config = {
  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 8788),

  /** Trailing slash stripped so `${ollamaUrl}/api/chat` concatenation is always well-formed. */
  ollamaUrl: str('OLLAMA_URL', 'http://127.0.0.1:11434').replace(/\/+$/, ''),
  defaultModel: str('GAIA_MODEL', ''),

  accessToken: str('GAIA_ACCESS_TOKEN', ''),

  systemPromptPath: resolve(str('GAIA_SYSTEM_PROMPT_PATH', './system_prompt.md')),

  dataDir,
  sessionFile: resolve(dataDir, 'sessions.json'),
  historyWindow: int('GAIA_HISTORY_WINDOW', 24),

  enabledTools: list('GAIA_TOOLS', ['get_date', 'get_weather', 'search_web']),
  firecrawlKey: str('FIRECRAWL_API_KEY', ''),

  /** Ceiling on tool round-trips per turn. Without it a confused model can loop indefinitely. */
  maxToolIterations: int('GAIA_MAX_TOOL_ITERATIONS', 4),
  /** Independent, tighter budget for the one tool that costs money and hits the network hard. */
  maxSearchesPerTurn: int('GAIA_MAX_SEARCHES_PER_TURN', 3),

  requestTimeoutMs: int('GAIA_REQUEST_TIMEOUT_MS', 120_000),
  toolTimeoutMs: int('GAIA_TOOL_TIMEOUT_MS', 20_000),
} as const;

export type Config = typeof config;
