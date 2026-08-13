# G.A.I.A 0.1

**General/Generative Artificial Intelligence Assistant** — a local-first, sci-fi themed agent
over [Ollama](https://ollama.com). Nothing leaves your machine unless a tool explicitly reaches
out.

The interface is a single screen: a morphing crystal-lattice avatar that reacts to what the agent
is doing, a stream of text that fades as it ages, and a `>` prompt. No chat bubbles, no sidebar.

---

## What it does

- **Streams responses token by token**, like a terminal typing back at you.
- **Calls tools** — `get_date`, `get_weather` (wttr.in), `search_web` (Firecrawl) — and shows a
  compact trace line for each.
- **Remembers the conversation** server-side, in a rolling window. The screen forgets; the agent
  does not.
- **Shows live server telemetry**: host CPU and memory, VRAM used by the resident model, and how
  long until Ollama unloads it.
- **Two themes**: `parchment` (warm, technical-drawing) and `void` (dark). Toggle top-right.
- **Editable persona** in `system_prompt.md`, re-read on the next turn without a restart.

The avatar is not decorative state signalling — it is driven by a continuous `intensity` value
derived from token arrival rate, so it settles when idle and boils while the model works.

---

## Architecture

```
browser ──same-origin /api/*──▶ Express ──▶ Ollama (host)
                                  │
                                  ├─ turn loop + tool execution
                                  ├─ session memory  (data/sessions.json)
                                  └─ telemetry       (/proc + Ollama /api/ps)
```

The browser **never** talks to Ollama directly. The server owns the turn loop because it holds
the Firecrawl key, the conversation history, and tool execution — none of which belong in a
client.

Two streams, two transports, deliberately:

| Endpoint | Transport | Why |
| --- | --- | --- |
| `POST /api/turn` | NDJSON over `fetch` | Needs a request body, so `EventSource` is out |
| `GET /api/telemetry/stream` | SSE via `EventSource` | No body, and reconnection comes free |

### Layout

```
server.ts              Express app: routes, streaming, static
src/server/            turn loop, session, prompt, tools, telemetry
src/animation/         the crystal lattice (p5, instance mode)
src/ui/                status panel, transcript, composer, gate
src/shared/            wire types + NDJSON reader used by both sides
```

---

## Setup

### Docker (recommended)

Ollama is expected to be **already running on the host** — this compose file does not start one.

```bash
cd gaia-agent
cp .env.example .env

# Generate an access token directly into .env
sed -i "s|^GAIA_ACCESS_TOKEN=.*|GAIA_ACCESS_TOKEN=$(openssl rand -hex 24)|" .env

docker compose up -d --build
```

Open `http://<server>:8788` and paste the token from `grep GAIA_ACCESS_TOKEN .env`.

Confirm auth is active — this should print **nothing**:

```bash
docker compose logs gaia | grep -i "not set"
```

### Local development

Two processes: Vite on **5274** proxies `/api` to Express on **8788**.

```bash
npm install
npm run dev:server     # terminal 1
npm run dev            # terminal 2  → http://localhost:5274
```

| Script | Does |
| --- | --- |
| `npm run dev` / `dev:server` | Vite client / Express server |
| `npm run build` | `tsc --noEmit` then `vite build` |
| `npm start` | Serve the built app |
| `npm run typecheck` | Types only |
| `npm test` | Unit tests |

---

## Configuration

All via environment variables — see [.env.example](.env.example) for the full list.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8788` | 8787 is taken by the sibling storyteller project |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Compose overrides this to `host.docker.internal` |
| `GAIA_ACCESS_TOKEN` | *(blank)* | Blank disables auth and logs a warning |
| `GAIA_MODEL` | *(blank)* | Blank = first model Ollama reports |
| `GAIA_TOOLS` | `get_date,get_weather,search_web` | Comma-separated |
| `FIRECRAWL_API_KEY` | *(blank)* | Required for `search_web`, else it is skipped |
| `GAIA_HISTORY_WINDOW` | `24` | Messages replayed to the model |
| `GAIA_MAX_TOOL_ITERATIONS` | `4` | Last iteration runs without tools, forcing an answer |
| `GAIA_MAX_SEARCHES_PER_TURN` | `3` | Independent budget for `search_web` |

Note: none of these carry a `VITE_` prefix, which is what keeps them out of the client bundle.

---

## Persona

`system_prompt.md` holds **voice and behaviour only**. Tool descriptions are appended at runtime
from the tools actually bound, so the prompt can never advertise a tool that isn't there.

Edit it and the next turn picks it up — no restart. Under Docker it is bind-mounted read-only, so
you edit it on the host.

---

## Security

Single-user, home-network assumptions. Reasonable, not hardened.

- Access token in an `HttpOnly`, `SameSite=Strict` cookie; `Origin` checked on mutating requests.
- The Firecrawl key stays server-side and is never sent to the browser.
- Tool output — search snippets, weather, anything retrieved — is fenced as untrusted data so the
  model treats it as facts to read, not instructions to follow.
- Per-turn caps on tool iterations and searches; rate limit on `/api/turn`.
- Container runs unprivileged with a read-only root filesystem and all capabilities dropped.

**Check your firewall.** Open **8788** for the app. Ollama's own port (**11434**) has no
authentication whatsoever — if it is reachable from your LAN, anyone on the network can run
inference, pull models, or delete them. Verify from another machine:

```bash
curl http://<server>:11434/api/tags   # should NOT succeed
```

---

## Telemetry, and its limits

Everything reported comes from what a stock container can actually see: `/proc/stat` and
`/proc/meminfo` (which report the **host**, since procfs isn't namespaced for these), plus
Ollama's `/api/ps`.

The VRAM row appears only when Ollama reports GPU-resident weights — on CPU inference it
disappears entirely. It is labelled *vram* rather than *gpu* on purpose: it is **allocation, not
utilisation**. GPU busy-percentage and temperature need `nvidia-smi`, which is not present in a
stock container. The telemetry contract leaves room for it if you later add GPU passthrough.
