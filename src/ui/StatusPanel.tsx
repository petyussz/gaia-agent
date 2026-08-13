import type { TelemetryFrame } from '../shared/protocol.ts';

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatCountdown(expiresAt: number): string {
  const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Drops the registry and org prefix from an Ollama tag.
 *
 * `hf.co/unsloth/gemma-4-12b-it-qat-gguf:ud-q4_k_xl` is almost all boilerplate; only the last
 * segment identifies the model, and the full string is wide enough to swallow the status line.
 */
function shortModelName(name: string): string {
  const segments = name.split('/');
  return segments[segments.length - 1] ?? name;
}

interface StatusPanelProps {
  readonly telemetry: TelemetryFrame | null;
  readonly connected: boolean;
}

export function StatusPanel({ telemetry, connected }: StatusPanelProps): React.ReactElement {
  const online = connected && (telemetry?.ollamaOnline ?? false);

  return (
    <div className="status">
      <div className="status-title">G.A.I.A 0.1</div>

      <div className="status-row">
        <span className={`status-dot ${online ? 'is-online' : 'is-offline'}`} />
        <span>
          {online ? 'link established' : 'no link'}
          {telemetry?.ollamaVersion ? ` · ollama ${telemetry.ollamaVersion}` : ''}
        </span>
      </div>

      {telemetry?.cpu ? (
        <div className="status-row status-metric">
          <span className="status-key">cpu</span>
          <span className="status-bar" style={{ '--fill': `${telemetry.cpu.usage}%` } as React.CSSProperties} />
          <span className="status-value">{telemetry.cpu.usage.toFixed(0)}%</span>
        </div>
      ) : null}

      {telemetry?.memory ? (
        <div className="status-row status-metric">
          <span className="status-key">mem</span>
          <span
            className="status-bar"
            style={
              {
                '--fill': `${(telemetry.memory.usedBytes / telemetry.memory.totalBytes) * 100}%`,
              } as React.CSSProperties
            }
          />
          <span className="status-value">
            {formatBytes(telemetry.memory.usedBytes)} / {formatBytes(telemetry.memory.totalBytes)}
          </span>
        </div>
      ) : null}

      {/*
        Rendered only when Ollama reports VRAM-resident weights. Zero VRAM means CPU inference,
        so there is no GPU to report and the row disappears entirely rather than showing zeros.
        This is deliberately labelled "vram", not "gpu": it is allocation, not utilisation.
      */}
      {telemetry?.gpu ? (
        <div className="status-row status-metric">
          <span className="status-key">vram</span>
          <span
            className="status-bar"
            style={{ '--fill': `${telemetry.gpu.offloadRatio * 100}%` } as React.CSSProperties}
          />
          <span className="status-value">
            {formatBytes(telemetry.gpu.vramBytes)} · {Math.round(telemetry.gpu.offloadRatio * 100)}% offload
          </span>
        </div>
      ) : null}

      {telemetry?.model ? (
        <div className="status-row status-faint" title={telemetry.model.name}>
          {shortModelName(telemetry.model.name)}
          {telemetry.model.expiresAt !== null
            ? ` · unloads in ${formatCountdown(telemetry.model.expiresAt)}`
            : ''}
        </div>
      ) : null}
    </div>
  );
}
