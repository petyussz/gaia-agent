/**
 * Parameters for the crystal network, as two endpoints of a single continuous axis.
 *
 * The prototypes were two separate files running the same algorithm with different constants.
 * Rather than swapping implementations — which would re-seed the node set and make the
 * silhouette visibly jump — every constant that differs becomes a lerpable field, and a single
 * `intensity` scalar in [0, 1] moves between them.
 *
 * Note which values came from where: `breathAmp` and `breathFreq` are taken from the *unused*
 * false branch of the prototype's `isThinking ? 18 : 6` ternary. That branch was the author's
 * stated intent for idle; it never ran because the flag was pinned to `true`.
 */
export interface CrystalParams {
  /** Advance of the master clock per 60fps frame. */
  readonly timeStep: number;

  readonly driftXAmp: number;
  readonly driftXFreq: number;
  readonly driftYAmp: number;
  readonly driftYFreq: number;

  readonly breathAmp: number;
  readonly breathFreq: number;

  readonly hubSwayAmp: number;
  readonly hubSwayFreq: number;

  readonly angularSwayAmp: number;
  readonly angularSwayFreq: number;
  /**
   * How much each node's index offsets its sway phase. Small values keep the ring moving as one
   * coherent wave; large values decorrelate the nodes so the outline appears to boil.
   */
  readonly angularIndexCoeff: number;

  /** Multiplier on each node's own noise rate. The single biggest contributor to "agitation". */
  readonly morphSpeedScale: number;
  readonly radialMorphLow: number;
  readonly radialMorphHigh: number;

  readonly pulseAmp: number;
  readonly pulseFreq: number;
  readonly pulseIndexCoeff: number;
}

/** Calm: coherent silhouette, slow undulation. */
export const IDLE: CrystalParams = {
  timeStep: 0.01,

  driftXAmp: 22,
  driftXFreq: 0.3,
  driftYAmp: 16.5,
  driftYFreq: 0.25,

  breathAmp: 6,
  breathFreq: 0.4,

  hubSwayAmp: 17.6,
  hubSwayFreq: 0.4,

  angularSwayAmp: 0.08,
  angularSwayFreq: 0.15,
  angularIndexCoeff: 0.2,

  morphSpeedScale: 0.3,
  radialMorphLow: 0.7,
  radialMorphHigh: 1.2,

  pulseAmp: 12,
  pulseFreq: 3.0,
  pulseIndexCoeff: 0.35,
};

/** Working: the thinking prototype's constants, where the silhouette boils. */
export const THINKING: CrystalParams = {
  timeStep: 0.016,

  driftXAmp: 20,
  driftXFreq: 0.4,
  driftYAmp: 15,
  driftYFreq: 0.3,

  breathAmp: 18,
  breathFreq: 1.2,

  hubSwayAmp: 30,
  hubSwayFreq: 0.8,

  angularSwayAmp: 0.15,
  angularSwayFreq: 0.2,
  angularIndexCoeff: 1.0,

  morphSpeedScale: 1.0,
  radialMorphLow: 0.5,
  radialMorphHigh: 1.3,

  pulseAmp: 12,
  pulseFreq: 2.5,
  pulseIndexCoeff: 0.3,
};

const KEYS = Object.keys(IDLE) as (keyof CrystalParams)[];

export function lerpParams(from: CrystalParams, to: CrystalParams, t: number): CrystalParams {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const result = {} as Record<keyof CrystalParams, number>;
  for (const key of KEYS) result[key] = from[key] + (to[key] - from[key]) * clamped;
  return result as CrystalParams;
}

export function paramsAt(intensity: number): CrystalParams {
  return lerpParams(IDLE, THINKING, intensity);
}

export interface CrystalPalette {
  readonly stroke: readonly [number, number, number];
  /** Alpha of the shortest connections; longer ones fade to zero. */
  readonly alphaMax: number;
  readonly weightMax: number;
}

/**
 * Per-theme line tuning. The background is not here — the canvas is transparent and the page
 * supplies it, so only the strokes need theming.
 *
 * The distance-fade ramp was tuned for dark ink on light paper. Light strokes on a dark ground
 * bloom, so `void` drops both the alpha ceiling and the stroke weight — the same numbers would
 * read as a glowing smear rather than a wireframe.
 */
export const PALETTES = {
  parchment: {
    stroke: [20, 20, 20],
    alphaMax: 140,
    weightMax: 1.4,
  },
  void: {
    stroke: [214, 222, 232],
    alphaMax: 118,
    weightMax: 1.1,
  },
} as const satisfies Record<string, CrystalPalette>;

export type ThemeName = keyof typeof PALETTES;
