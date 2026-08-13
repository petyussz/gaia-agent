import { describe, expect, it } from 'vitest';

import { IDLE, THINKING, lerpParams, paramsAt } from './params.ts';

describe('crystal parameters', () => {
  it('returns the endpoints exactly', () => {
    expect(paramsAt(0)).toEqual(IDLE);
    expect(paramsAt(1)).toEqual(THINKING);
  });

  it('clamps out-of-range intensity', () => {
    expect(paramsAt(-3)).toEqual(IDLE);
    expect(paramsAt(9)).toEqual(THINKING);
  });

  it('interpolates every field, not just some', () => {
    const middle = paramsAt(0.5);
    for (const key of Object.keys(IDLE) as (keyof typeof IDLE)[]) {
      expect(middle[key]).toBeCloseTo((IDLE[key] + THINKING[key]) / 2, 10);
    }
  });

  it('moves the parameters that actually drive the visual change', () => {
    // The prototypes only interpolated speed, pulse and drift — the three that matter least.
    // Agitation comes from noise rate, radial span and node decorrelation.
    expect(THINKING.morphSpeedScale).toBeGreaterThan(IDLE.morphSpeedScale);
    expect(THINKING.angularIndexCoeff).toBeGreaterThan(IDLE.angularIndexCoeff);
    expect(THINKING.radialMorphHigh - THINKING.radialMorphLow).toBeGreaterThan(
      IDLE.radialMorphHigh - IDLE.radialMorphLow,
    );
  });

  it('converges toward the target under repeated easing', () => {
    let current = IDLE;
    for (let i = 0; i < 200; i += 1) current = lerpParams(current, THINKING, 0.04);
    expect(current.morphSpeedScale).toBeCloseTo(THINKING.morphSpeedScale, 3);
  });
});
