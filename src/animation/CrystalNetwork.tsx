import { useEffect, useRef } from 'react';

import { mountCrystalNetwork, type CrystalDriver } from './crystal-network.ts';
import type { ThemeName } from './params.ts';

interface CrystalNetworkProps {
  /** 0 = idle, 1 = working. Anything between is a valid, meaningful state. */
  readonly intensity: number;
  readonly theme: ThemeName;
}

export function CrystalNetwork({ intensity, theme }: CrystalNetworkProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);

  // State reaches the sketch through a ref rather than through props-in-deps. If `intensity`
  // were an effect dependency the sketch would tear down and remount on every token, re-seeding
  // the node set several times a second.
  const driverRef = useRef<CrystalDriver>({ intensity, theme });
  driverRef.current.intensity = intensity;
  driverRef.current.theme = theme;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    // The teardown is not optional: StrictMode invokes this effect twice in development, and
    // without it the second mount leaves a duplicate canvas animating underneath.
    return mountCrystalNetwork(host, driverRef.current);
  }, []);

  return <div ref={hostRef} className="crystal-host" aria-hidden="true" />;
}
