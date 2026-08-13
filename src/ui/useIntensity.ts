import { useCallback, useEffect, useRef, useState } from 'react';

/** Floor while a turn is in flight but no tokens are arriving — the "waiting" agitation. */
const WAITING = 0.78;
/** Tokens per sample window that count as full-rate generation. */
const FULL_RATE = 12;
const SAMPLE_MS = 150;

/**
 * Maps agent activity onto the animation's `intensity` axis.
 *
 * A boolean busy/idle flag would work, but the sketch asks for the network to react to the
 * response as it streams. Sampling token arrival rate gives that for free: waiting on the first
 * token sits at a restless floor, and fast generation pushes it to full.
 */
export function useIntensity(active: boolean): { intensity: number; noteToken: () => void } {
  const [intensity, setIntensity] = useState(0);
  const counter = useRef(0);

  useEffect(() => {
    if (!active) {
      setIntensity(0);
      return undefined;
    }

    setIntensity(WAITING);
    const timer = setInterval(() => {
      const tokens = counter.current;
      counter.current = 0;
      const rate = Math.min(1, tokens / FULL_RATE);
      setIntensity(WAITING + (1 - WAITING) * rate);
    }, SAMPLE_MS);

    return () => clearInterval(timer);
  }, [active]);

  const noteToken = useCallback(() => {
    counter.current += 1;
  }, []);

  return { intensity, noteToken };
}
