import { useEffect, useRef } from 'react';

export type LineKind = 'user' | 'agent' | 'tool';

export interface Line {
  readonly id: string;
  readonly kind: LineKind;
  readonly text: string;
  readonly ok?: boolean;
  readonly pending?: boolean;
}

interface TranscriptProps {
  readonly lines: readonly Line[];
  readonly streaming: string;
}

/**
 * How many lines from the bottom remain fully opaque before the fade begins. Beyond this the
 * transcript dissolves upward rather than scrolling away — the "disappearing stream" in the
 * sketch. Nothing is deleted; the session keeps the full history.
 */
const SOLID_LINES = 6;
const FADE_SPAN = 5;

function opacityFor(indexFromEnd: number): number {
  if (indexFromEnd < SOLID_LINES) return 1;
  const faded = (indexFromEnd - SOLID_LINES) / FADE_SPAN;
  return Math.max(0, 1 - faded);
}

export function Transcript({ lines, streaming }: TranscriptProps): React.ReactElement {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines.length, streaming]);

  const total = lines.length + (streaming ? 1 : 0);

  return (
    <div className="transcript">
      {lines.map((line, index) => {
        const fromEnd = total - 1 - index;
        const opacity = opacityFor(fromEnd);
        if (opacity === 0) return null;

        return (
          <p
            key={line.id}
            className={`line line-${line.kind}${line.ok === false ? ' is-failed' : ''}${
              line.pending ? ' is-pending' : ''
            }`}
            style={{ opacity }}
          >
            {line.kind === 'user' ? <span className="line-caret">&gt;</span> : null}
            {line.text}
            {line.pending ? <span className="ellipsis" /> : null}
          </p>
        );
      })}

      {streaming ? (
        <p className="line line-agent is-streaming">
          {streaming}
          <span className="cursor" />
        </p>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}
