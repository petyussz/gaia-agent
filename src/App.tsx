import { useCallback, useEffect, useRef, useState } from 'react';

import { CrystalNetwork } from './animation/CrystalNetwork.tsx';
import type { ThemeName } from './animation/params.ts';
import {
  getAuthStatus,
  getModels,
  resetSession,
  streamTurn,
  subscribeTelemetry,
} from './api.ts';
import type { ModelInfo, TelemetryFrame } from './shared/protocol.ts';
import { Composer } from './ui/Composer.tsx';
import { Gate } from './ui/Gate.tsx';
import { ModelSelector } from './ui/ModelSelector.tsx';
import { StatusPanel } from './ui/StatusPanel.tsx';
import { Transcript, type Line } from './ui/Transcript.tsx';
import { useIntensity } from './ui/useIntensity.ts';
import { createId } from './utils/id.ts';

/** Ceiling on how far the network rises to make room for text, in px. */
const MAX_LIFT = 88;
const LIFT_PER_LINE = 18;

function storedTheme(): ThemeName {
  return localStorage.getItem('gaia-theme') === 'void' ? 'void' : 'parchment';
}

export function App(): React.ReactElement {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [models, setModels] = useState<readonly ModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryFrame | null>(null);
  const [theme, setTheme] = useState<ThemeName>(storedTheme);

  const [lines, setLines] = useState<readonly Line[]>([]);
  const [streaming, setStreaming] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const { intensity, noteToken } = useIntensity(busy);

  /**
   * The transcript occupies only the lower part of the screen, but the whole stage should feel
   * scrollable — a wheel over the avatar or the empty space above the text would otherwise do
   * nothing at all, which reads as "the history is stuck".
   */
  const onStageWheel = useCallback((event: React.WheelEvent) => {
    const element = transcriptRef.current;
    // Inside the transcript the browser already scrolls it natively; doing both would double.
    if (!element || element.contains(event.target as Node)) return;
    element.scrollTop += event.deltaY;
  }, []);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    localStorage.setItem('gaia-theme', theme);
  }, [theme]);

  useEffect(() => {
    void getAuthStatus()
      .then((status) => setAuthed(status.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const response = await getModels();
      setModels(response.models);
      setModel((current) =>
        current && response.models.some((entry) => entry.id === current)
          ? current
          : response.active,
      );
      setNotice(response.models.length === 0 ? 'no models available' : '');
    } catch {
      setNotice('ollama unreachable');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed !== true) return undefined;
    void refreshModels();
    return subscribeTelemetry(setTelemetry);
  }, [authed, refreshModels]);

  const takeTurn = useCallback(async () => {
    const prompt = input.trim();
    if (prompt === '' || model === '') return;

    setInput('');
    setNotice('');
    setLines((current) => [...current, { id: createId(), kind: 'user', text: prompt }]);
    setStreaming('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamTurn(
        prompt,
        model,
        (event) => {
          switch (event.type) {
            case 'token':
              noteToken();
              // Functional form is required: deltas arrive faster than React commits, and
              // `setStreaming(streaming + delta)` would read a stale value and drop tokens.
              setStreaming((text) => text + event.delta);
              break;

            case 'rollback':
              // Prose that preceded a tool call was a preamble to work not yet done. Drop it
              // rather than leaving it stranded above the real answer.
              setStreaming('');
              break;

            case 'tool_start':
              setLines((current) => [
                ...current,
                {
                  id: event.call.id,
                  kind: 'tool',
                  text: `${event.call.name}(${Object.values(event.call.args).join(', ')})`,
                  pending: true,
                },
              ]);
              break;

            case 'tool_end':
              setLines((current) =>
                current.map((line) =>
                  line.id === event.id
                    ? { ...line, text: `${line.text} → ${event.summary}`, ok: event.ok, pending: false }
                    : line,
                ),
              );
              break;

            case 'done':
              setStreaming('');
              if (event.text.trim() !== '') {
                setLines((current) => [
                  ...current,
                  { id: createId(), kind: 'agent', text: event.text },
                ]);
              }
              break;

            case 'error':
              setStreaming('');
              setNotice(event.message);
              break;

            default:
              break;
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : 'the turn failed');
      }
      setStreaming('');
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [input, model, noteToken]);

  const onReset = useCallback(async () => {
    await resetSession().catch(() => undefined);
    setLines([]);
    setStreaming('');
    setNotice('');
  }, []);

  if (authed === null) return <div className="boot" />;
  if (!authed) return <Gate onAuthenticated={() => setAuthed(true)} />;

  // The network rises as the conversation grows, then holds — the sketch's "may move up to an
  // extent to make room for more text". Resetting the session returns it to its origin.
  const lift = Math.min(MAX_LIFT, lines.length * LIFT_PER_LINE);

  return (
    <div className="app" style={{ '--lift': `${lift}px` } as React.CSSProperties}>
      <header className="hud">
        <StatusPanel telemetry={telemetry} connected={authed} />
        <ModelSelector
          models={models}
          value={model}
          loading={modelsLoading}
          busy={busy}
          theme={theme}
          onChange={setModel}
          onToggleTheme={() => setTheme((current) => (current === 'parchment' ? 'void' : 'parchment'))}
        />
      </header>

      <main className="stage" onWheel={onStageWheel}>
        <div className="crystal-frame">
          <CrystalNetwork intensity={intensity} theme={theme} />
        </div>

        <Transcript lines={lines} streaming={streaming} scrollRef={transcriptRef} />
      </main>

      <footer className="dock">
        {notice ? <div className="notice">{notice}</div> : null}
        <Composer
          value={input}
          busy={busy}
          disabled={model === ''}
          onChange={setInput}
          onSubmit={() => void takeTurn()}
          onCancel={() => abortRef.current?.abort()}
          onReset={() => void onReset()}
        />
      </footer>
    </div>
  );
}
