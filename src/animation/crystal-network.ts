import p5 from 'p5';

import {
  IDLE,
  PALETTES,
  lerpParams,
  paramsAt,
  type CrystalParams,
  type CrystalPalette,
  type ThemeName,
} from './params.ts';

const NODE_COUNT = 40;
const BASE_SCALE = 150;
const MAX_CONNECT_DISTANCE = 120;
/** Container size at which the prototype's absolute pixel constants look right. */
const REFERENCE_SIZE = 460;
/** Per-frame approach rate toward the target parameter set. ~40 frames to 80% convergence. */
const EASE = 0.04;

export interface CrystalDriver {
  /** 0 = idle, 1 = working. Written from React without remounting the sketch. */
  intensity: number;
  theme: ThemeName;
}

interface Node {
  readonly index: number;
  readonly baseAngle: number;
  readonly depth: number;
  readonly noiseSeedX: number;
  readonly noiseSeedY: number;
  /** Per-node noise rate, scaled globally by `morphSpeedScale`. */
  readonly morphSpeed: number;
  x: number;
  y: number;
}

/**
 * Mounts the crystal network into `host` and returns a teardown function.
 *
 * Instance mode rather than p5's global mode: global mode installs `setup`/`draw` on `window`,
 * which allows only one sketch per page and leaks into any other script on it.
 */
export function mountCrystalNetwork(host: HTMLElement, driver: CrystalDriver): () => void {
  const sketch = (p: p5): void => {
    let nodes: Node[] = [];
    let current: CrystalParams = { ...IDLE };

    // Phase accumulators, one per oscillator.
    //
    // This is the difference between a smooth transition and a broken one. The prototypes wrote
    // every oscillator as `sin(globalTime * freq)` with `globalTime` growing without bound. Under
    // interpolation that is unusable: changing `freq` by even a little shifts the argument by
    // `Δfreq × globalTime`, so after a minute of runtime the wave jumps to an arbitrary point in
    // its cycle and the animation visibly snaps. Accumulating phase makes frequency changes
    // continuous by construction — the wave keeps its position and only its rate changes.
    let driftXPhase = 0;
    let driftYPhase = 0;
    let breathPhase = 0;
    let hubPhase = 0;
    let swayPhase = 0;
    let morphPhase = 0;
    let pulsePhase = 0;

    function buildNodes(): void {
      nodes = [];
      for (let i = 0; i < NODE_COUNT; i += 1) {
        nodes.push({
          index: i,
          baseAngle: ((p.TWO_PI / NODE_COUNT) * i) + p.random(-0.1, 0.1),
          depth: i === 0 ? 0 : p.random(0.3, 1.15),
          noiseSeedX: p.random(1000),
          noiseSeedY: p.random(2000),
          morphSpeed: p.random(0.8, 1.4),
          x: 0,
          y: 0,
        });
      }
    }

    function containerSize(): { width: number; height: number } {
      const rect = host.getBoundingClientRect();
      return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    }

    p.setup = (): void => {
      const { width, height } = containerSize();
      p.createCanvas(width, height);
      buildNodes();
    };

    p.draw = (): void => {
      const palette: CrystalPalette = PALETTES[driver.theme] ?? PALETTES.parchment;
      const [inkR, inkG, inkB] = palette.stroke;

      // `clear()`, not `background()`. The prototypes painted an opaque fill matching the page,
      // which is fine full-screen but not here: the frame slides upward over the HUD, and an
      // opaque canvas would erase the header underneath it. Transparent also means the theme
      // switch needs no repaint of its own.
      p.clear();

      // Frame-rate independence: the prototypes assumed a fixed 60fps step. The clamp stops a
      // long stall (background tab, blocked main thread) from advancing the clock in one jump.
      const frameScale = Math.min(p.deltaTime, 100) / (1000 / 60);

      current = lerpParams(current, paramsAt(driver.intensity), EASE);
      const step = current.timeStep * frameScale;

      driftXPhase += current.driftXFreq * step;
      driftYPhase += current.driftYFreq * step;
      breathPhase += current.breathFreq * step;
      hubPhase += current.hubSwayFreq * step;
      swayPhase += current.angularSwayFreq * step;
      morphPhase += current.morphSpeedScale * step;
      pulsePhase += current.pulseFreq * step;

      // Both the radius and the connection threshold scale by the same factor. They must move
      // in lockstep: scaling one alone changes how many pairs fall inside the threshold, so the
      // mesh would get denser or sparser with the container instead of merely larger.
      const scale = Math.min(2, Math.max(0.45, Math.min(p.width, p.height) / REFERENCE_SIZE));
      const connectDistance = MAX_CONNECT_DISTANCE * scale;

      const cx = p.width / 2 + Math.sin(driftXPhase) * current.driftXAmp * scale;
      const cy = p.height / 2 + Math.cos(driftYPhase) * current.driftYAmp * scale;
      const breathingScale = (BASE_SCALE + Math.sin(breathPhase) * current.breathAmp) * scale;

      for (const node of nodes) {
        if (node.index === 0) {
          node.x = cx + (p.noise(hubPhase) - 0.5) * current.hubSwayAmp * scale;
          node.y = cy + (p.noise(hubPhase + 500) - 0.5) * current.hubSwayAmp * scale;
          continue;
        }

        const angle =
          node.baseAngle +
          Math.sin(swayPhase + node.index * current.angularIndexCoeff) * current.angularSwayAmp;

        const noiseAt = morphPhase * node.morphSpeed;
        const noiseFactor = p.noise(node.noiseSeedX + noiseAt, node.noiseSeedY + noiseAt);
        const radialMorph =
          current.radialMorphLow +
          noiseFactor * (current.radialMorphHigh - current.radialMorphLow);

        // The `- index * coeff` term staggers the pulse around the ring, so it reads as a
        // travelling ripple rather than a synchronised throb.
        const pulse =
          Math.sin(pulsePhase - node.index * current.pulseIndexCoeff) * current.pulseAmp * scale;

        const radius = (node.depth * breathingScale + pulse) * radialMorph;
        const rawX = Math.cos(angle) * radius;
        const rawY = Math.sin(angle) * radius;

        // Asymmetric shear — what turns a circular ring into a faceted crystal.
        node.x = cx + rawX * 1.1 + rawY * 0.2;
        node.y = cy + rawY * 0.85 - rawX * 0.15;
      }

      // Adjacency.
      const adjacency: number[][] = Array.from({ length: nodes.length }, () => []);
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        if (!a) continue;
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          if (!b) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) < connectDistance) {
            adjacency[i]?.push(j);
            adjacency[j]?.push(i);
          }
        }
      }

      // Reachability from the hub. Nodes that have drifted out of range are dropped entirely,
      // which is what keeps the shape reading as one crystal rather than scattered debris.
      const reachable = new Array<boolean>(nodes.length).fill(false);
      const queue: number[] = [0];
      reachable[0] = true;
      while (queue.length > 0) {
        const currentIndex = queue.shift();
        if (currentIndex === undefined) break;
        for (const neighbour of adjacency[currentIndex] ?? []) {
          if (reachable[neighbour]) continue;
          reachable[neighbour] = true;
          queue.push(neighbour);
        }
      }

      // Render. Nodes themselves are never drawn — only the connections between them.
      for (let i = 0; i < nodes.length; i += 1) {
        if (!reachable[i]) continue;
        const a = nodes[i];
        if (!a) continue;

        for (const j of adjacency[i] ?? []) {
          if (j <= i || !reachable[j]) continue;
          const b = nodes[j];
          if (!b) continue;

          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const ratio = distance / connectDistance;
          p.stroke(inkR, inkG, inkB, palette.alphaMax * (1 - ratio));
          p.strokeWeight(palette.weightMax * (1 - ratio) + 0.25 * ratio);
          p.line(a.x, a.y, b.x, b.y);
        }
      }
    };
  };

  const instance = new p5(sketch, host);

  // Resize without rebuilding the node set. The prototype re-seeded every node here, which made
  // the silhouette pop to a different shape on every resize — including the transient ones React
  // and devtools produce.
  const observer = new ResizeObserver(() => {
    const rect = host.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      instance.resizeCanvas(Math.round(rect.width), Math.round(rect.height));
    }
  });
  observer.observe(host);

  return () => {
    observer.disconnect();
    instance.remove();
  };
}
