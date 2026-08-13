import { useEffect, useRef } from 'react';

interface ComposerProps {
  readonly value: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly onReset: () => void;
}

export function Composer({
  value,
  busy,
  disabled,
  onChange,
  onSubmit,
  onCancel,
  onReset,
}: ComposerProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  // The composer stays mounted and focusable during a turn. Hiding it — as the predecessor did —
  // removes the ability to cancel at exactly the moment it is most wanted.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && value.trim() !== '') onSubmit();
      }}
    >
      <span className="composer-caret">&gt;</span>
      <input
        ref={inputRef}
        className="composer-input"
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        placeholder={busy ? '' : 'ask'}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && busy) onCancel();
        }}
      />
      {busy ? (
        <button type="button" className="composer-action" onClick={onCancel}>
          stop
        </button>
      ) : (
        <button type="button" className="composer-action" onClick={onReset} title="Clear session memory">
          reset
        </button>
      )}
    </form>
  );
}
