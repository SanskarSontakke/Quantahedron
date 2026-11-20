/**
 * Demo Director engine (§3.4) — a declarative, simulation-agnostic keyframe
 * interpreter. A "guided kinetic tour" is nothing but a list of
 * `{ at, params, caption }` keyframes over the store's flat parameter map; this
 * module samples that timeline at time t and returns the parameter patch to
 * apply. Because every sim keeps its state in the same place, one director
 * drives all ten, including camera orbits and shader crossfades.
 *
 * Pure TypeScript: no React, safe to unit test.
 */

import type { DemoKeyframe, DemoScript, SimParamValue, SimParams } from '@/simulations/types';

export interface DemoSample {
  patch: SimParams;
  caption: string | null;
  progress: number;
  finished: boolean;
  /** Index of the keyframe currently in effect. */
  index: number;
}

const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

function lerpArray(a: number[], b: number[], u: number): number[] {
  const n = Math.max(a.length, b.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? av;
    out[i] = Math.round((av + (bv - av) * u) * 1000) / 1000;
  }
  return out;
}

function sameLength(a: number[], b: number[]): boolean {
  return a.length === b.length;
}

/**
 * Sample the tour at `t` seconds.
 *
 * Numeric and numeric-array targets interpolate from the previous keyframe's
 * value (falling back to the live baseline), which is what makes parameter
 * ramps look continuous. Strings / booleans switch at their keyframe instant,
 * and a keyframe flagged `instant` snaps even numerics.
 */
export function sampleDemo(
  script: DemoScript,
  t: number,
  baseline: SimParams,
): DemoSample {
  const frames = [...script.keyframes].sort((a, b) => a.at - b.at);
  const patch: SimParams = {};

  let index = -1;
  for (let i = 0; i < frames.length; i++) if (frames[i].at <= t) index = i;

  const prev: DemoKeyframe | null = index >= 0 ? frames[index] : null;
  const next: DemoKeyframe | null = index + 1 < frames.length ? frames[index + 1] : null;
  const span = next ? Math.max(1e-6, next.at - (prev?.at ?? 0)) : 1;
  const u = next ? easeInOut(Math.min(1, Math.max(0, (t - (prev?.at ?? 0)) / span))) : 0;

  // Discrete values from every keyframe already passed.
  for (let i = 0; i <= index; i++) {
    const kp = frames[i].params;
    if (!kp) continue;
    for (const [key, value] of Object.entries(kp)) {
      if (typeof value === 'string' || typeof value === 'boolean') patch[key] = value;
    }
  }

  // Numeric ramps toward the next keyframe.
  const targetKeys = new Set<string>();
  if (prev?.params) for (const k of Object.keys(prev.params)) targetKeys.add(k);
  if (next?.params) for (const k of Object.keys(next.params)) targetKeys.add(k);

  for (const key of targetKeys) {
    const rawFrom = prev?.params?.[key] ?? baseline[key];
    const rawTo = next?.params?.[key] ?? rawFrom;
    if (rawFrom === undefined || rawTo === undefined) continue;

    if (typeof rawFrom === 'number' && typeof rawTo === 'number') {
      const snap = prev?.instant || !next || t >= script.durationSec;
      const from = snap ? rawTo : rawFrom;
      patch[key] = Math.round((from + (rawTo - from) * (snap ? 1 : u)) * 1000) / 1000;
      continue;
    }
    if (Array.isArray(rawFrom) && Array.isArray(rawTo)) {
      const a = rawFrom as number[];
      const b = rawTo as number[];
      patch[key] = prev?.instant || !next || !sameLength(a, b) ? b : lerpArray(a, b, u);
      continue;
    }
    // Mixed types → step at the keyframe boundary.
    patch[key] = t >= (next?.at ?? Infinity) ? rawTo : rawFrom;
  }

  if (next === null && prev?.params) {
    // Final hold: pin every numeric to its target.
    for (const [key, value] of Object.entries(prev.params)) {
      if (typeof value === 'number' || Array.isArray(value)) patch[key] = value as SimParamValue;
    }
  }

  const captionSource = index >= 0 ? frames[index] : null;
  return {
    patch,
    caption: captionSource?.caption ?? null,
    progress: Math.min(1, Math.max(0, t / Math.max(1e-6, script.durationSec))),
    finished: t >= script.durationSec,
    index,
  };
}

/** Human timeline for the overlay: label chips at each caption boundary. */
export function demoChapters(script: DemoScript): { at: number; label: string }[] {
  return script.keyframes
    .filter((k) => k.caption)
    .sort((a, b) => a.at - b.at)
    .map((k) => ({ at: k.at, label: k.caption as string }));
}
