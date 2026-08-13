import { useCallback, useEffect, useRef, useState } from 'react';

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
  /**
   * Owned by the parent so a wheel event anywhere over the stage can scroll this element. Most
   * of the screen is the avatar and empty space, and a wheel there would otherwise do nothing.
   */
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
}

/** Distance from the bottom, in px, within which the view still counts as "following". */
const STICK_THRESHOLD = 56;

/**
 * The conversation, dissolving upward.
 *
 * The fade is a property of *position*, not age: it comes from a CSS mask on this scroll
 * container rather than per-line opacity. That distinction is what makes the history reachable —
 * an age-based fade renders old lines invisible (and previously unmounted them entirely), so
 * there was nothing left to scroll back to.
 */
export function Transcript({ lines, streaming, scrollRef }: TranscriptProps): React.ReactElement {
  const [scrolled, setScrolled] = useState(false);
  // Whether the view should follow new output. Kept in a ref so it can be read during the
  // scroll effect without making that effect re-run.
  const following = useRef(true);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    setScrolled(element.scrollTop > 4);
    following.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD;
  }, [scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    // Only auto-scroll when the reader is already at the bottom. Following unconditionally would
    // yank them back down mid-sentence every time a token arrived.
    if (!element || !following.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lines.length, streaming, scrollRef]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`transcript${scrolled ? ' is-scrolled' : ''}`}
    >
      {lines.map((line) => (
        <p
          key={line.id}
          className={`line line-${line.kind}${line.ok === false ? ' is-failed' : ''}${
            line.pending ? ' is-pending' : ''
          }`}
        >
          {line.kind === 'user' ? <span className="line-caret">&gt;</span> : null}
          {line.text}
          {line.pending ? <span className="ellipsis" /> : null}
        </p>
      ))}

      {streaming ? (
        <p className="line line-agent is-streaming">
          {streaming}
          <span className="cursor" />
        </p>
      ) : null}
    </div>
  );
}
