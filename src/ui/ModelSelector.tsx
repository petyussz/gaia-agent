import type { ModelInfo } from '../shared/protocol.ts';
import type { ThemeName } from '../animation/params.ts';

interface ModelSelectorProps {
  readonly models: readonly ModelInfo[];
  readonly value: string;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly theme: ThemeName;
  readonly onChange: (model: string) => void;
  readonly onToggleTheme: () => void;
}

export function ModelSelector({
  models,
  value,
  loading,
  busy,
  theme,
  onChange,
  onToggleTheme,
}: ModelSelectorProps): React.ReactElement {
  const active = models.find((entry) => entry.id === value);

  return (
    <div className="selector">
      <button
        type="button"
        className="selector-theme"
        onClick={onToggleTheme}
        title="Switch theme"
        aria-label="Switch theme"
      >
        {theme === 'parchment' ? 'void' : 'parchment'}
      </button>

      <select
        className="selector-select"
        value={value}
        disabled={busy || models.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {models.length === 0 ? <option value="">no models</option> : null}
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.supportsTools ? model.label : `${model.label} — no tools`}
          </option>
        ))}
      </select>

      {/* The sketch's "moving …" affordance: model load is the long, invisible wait. */}
      {loading ? <span className="selector-loading">loading model<span className="ellipsis" /></span> : null}

      {active && !active.supportsTools ? (
        <span className="selector-warning">this model cannot call tools</span>
      ) : null}
    </div>
  );
}
