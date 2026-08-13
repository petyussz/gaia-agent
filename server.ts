import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { z } from 'zod';

import {
  attemptLogin,
  authRequired,
  isAuthenticated,
  readCookie,
  requireAuth,
  revokeSession,
  sameOriginOnly,
} from './src/server/auth.ts';
import { config } from './src/server/config.ts';
import { getVersion, listModels } from './src/server/ollama.ts';
import * as session from './src/server/session.ts';
import { subscribe } from './src/server/telemetry/sampler.ts';
import { toolNames } from './src/server/tools/index.ts';
import { runTurn } from './src/server/turn.ts';
import type { HealthResponse, ModelsResponse } from './src/shared/protocol.ts';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, 'dist');
const indexHtml = join(distDir, 'index.html');

const SESSION_COOKIE = 'gaia_session';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(sameOriginOnly);

// ── Session identity ─────────────────────────────────────────────────────────────────────────

function sessionId(req: express.Request, res: express.Response): string {
  const existing = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (existing !== null && /^[0-9a-f-]{36}$/i.test(existing)) return existing;

  const created = session.createSessionId();
  res.cookie(SESSION_COOKIE, created, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return created;
}

// ── Rate limiting ────────────────────────────────────────────────────────────────────────────

const recentTurns = new Map<string, number[]>();
const inFlight = new Set<string>();

function allowTurn(id: string): boolean {
  const now = Date.now();
  const window = recentTurns.get(id)?.filter((ts) => now - ts < 60_000) ?? [];
  if (window.length >= 20) return false;
  window.push(now);
  recentTurns.set(id, window);
  return true;
}

// ── Auth (public) ────────────────────────────────────────────────────────────────────────────

app.get('/api/auth/status', (req, res) => {
  res.json({ authRequired: authRequired(), authenticated: isAuthenticated(req) });
});

app.post('/api/auth', (req, res) => {
  const token = (req.body as { token?: unknown } | undefined)?.token;
  if (!attemptLogin(token, res)) {
    res.status(401).json({ error: 'Invalid token.' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/auth/logout', (_req, res) => {
  revokeSession(res);
  res.json({ ok: true });
});

// Everything below requires a valid session.
app.use('/api', requireAuth);

// ── Status ───────────────────────────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  const version = await getVersion();
  const body: HealthResponse = {
    ok: true,
    ollamaOnline: version !== null,
    authRequired: authRequired(),
    tools: toolNames(),
  };
  res.json(body);
});

app.get('/api/models', async (_req, res) => {
  try {
    const models = await listModels();
    const active =
      config.defaultModel !== '' && models.some((entry) => entry.id === config.defaultModel)
        ? config.defaultModel
        : (models[0]?.id ?? '');

    const body: ModelsResponse = { models, active };
    res.json(body);
  } catch {
    res.status(502).json({ error: 'Ollama is unreachable.' });
  }
});

// ── Telemetry (SSE) ──────────────────────────────────────────────────────────────────────────

app.get('/api/telemetry/stream', (_req, res) => {
  res.status(200);
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  // Stops any reverse proxy in front of this from buffering the stream into uselessness.
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders();

  const unsubscribe = subscribe((frame) => {
    res.write(`data: ${JSON.stringify(frame)}\n\n`);
  });

  // Must be the response, not the request: `req`'s 'close' fires as soon as the request body
  // has been read, which for a bodyless GET is immediately — it would unsubscribe at once.
  res.on('close', unsubscribe);
});

// ── Turn (NDJSON) ────────────────────────────────────────────────────────────────────────────

const turnSchema = z.object({
  prompt: z.string().trim().min(1).max(8_000),
  model: z.string().trim().min(1).max(200),
});

app.post('/api/turn', async (req, res) => {
  const parsed = turnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A prompt and a model are required.' });
    return;
  }

  const id = sessionId(req, res);

  if (inFlight.has(id)) {
    res.status(409).json({ error: 'A turn is already in progress.' });
    return;
  }
  if (!allowTurn(id)) {
    res.status(429).json({ error: 'Too many turns. Wait a moment.' });
    return;
  }

  const controller = new AbortController();
  // Detect a genuine client disconnect so an abandoned turn stops costing GPU time.
  //
  // This has to hang off the *response*. `req`'s 'close' event fires once the request body has
  // been consumed — which `express.json()` does before the handler even runs — so listening
  // there aborts every turn instantly and then silently swallows the error as "user cancelled".
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  res.status(200);
  res.setHeader('content-type', 'application/x-ndjson');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders();

  inFlight.add(id);
  try {
    for await (const event of runTurn({
      sessionId: id,
      model: parsed.data.model,
      prompt: parsed.data.prompt,
      signal: controller.signal,
    })) {
      res.write(`${JSON.stringify(event)}\n`);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('[turn]', error);
      // Generic on the wire, detailed in the server log: upstream errors can carry internal
      // detail, and the transcript is not the place for it.
      res.write(`${JSON.stringify({ type: 'error', message: 'The turn failed.' })}\n`);
    }
  } finally {
    inFlight.delete(id);
    res.end();
  }
});

app.post('/api/session/reset', (req, res) => {
  session.reset(sessionId(req, res));
  res.json({ ok: true });
});

// ── Static frontend ──────────────────────────────────────────────────────────────────────────

app.use(express.static(distDir));

// Express 5 uses path-to-regexp v8, which throws at startup on a bare '*' route.
app.get('/{*path}', (_req, res) => {
  if (!existsSync(indexHtml)) {
    res.status(503).send('Frontend not built. Run: npm run build');
    return;
  }
  res.sendFile(indexHtml);
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server]', error);
  if (!res.headersSent) res.status(500).json({ error: 'Internal error.' });
});

// ── Boot ─────────────────────────────────────────────────────────────────────────────────────

createServer(app).listen(config.port, config.host, () => {
  console.log(`[gaia] listening on http://${config.host}:${config.port}`);
  console.log(`[gaia] ollama: ${config.ollamaUrl}`);
  console.log(`[gaia] tools: ${toolNames().join(', ') || 'none'}`);

  if (!authRequired()) {
    console.warn(
      '[gaia] GAIA_ACCESS_TOKEN is not set — anyone who can reach this port can drive the agent.',
    );
  }
});
