/**
 * live.ts — the mutable frame state shared by the two viewports.
 *
 * The Canvas2D beam bench owns the animation clock (`useAnimationClock` in
 * Canvas.tsx) and writes this singleton every frame; the R3F Bloch sphere only
 * *reads* it inside `useFrame`. That keeps a single rAF-driven source of truth, so
 * the precessing vector on the sphere is always the spinor the beam is carrying at
 * that exact instant — and no React state is touched 60×/s.
 *
 * Module-level mutable objects are SSR-safe (no window, no THREE) and are reset by
 * the bench whenever the shot is re-armed.
 */

import type { Vec3 } from '@/engine/physics/blochSpin';

/** Ring-buffer capacity for the Bloch-sphere trail. */
export const TRAIL_MAX = 288;

export interface LiveSpin {
  /** Accumulated display phase in full turns (Larmor). */
  turns: number;
  /** Packet progress along the bench, 0 = source, 1 = detector. */
  phase: number;
  /** Bloch vector of the spinor the packet is carrying right now. */
  bloch: Vec3;
  /** 1-based analyser the packet is crossing; 0 = still between source and SG1. */
  stage: number;
  /** Wall-clock seconds stamp of the last projective collapse (for the flash). */
  flash: number;
  /** Trail ring buffer, xyz interleaved. */
  trail: Float32Array;
  trailHead: number;
  trailLen: number;
  /** performance.now() of the last write. */
  stamp: number;
}

export function createLiveSpin(): LiveSpin {
  return {
    turns: 0,
    phase: 0,
    bloch: [0, 0, 1],
    stage: 0,
    flash: -10,
    trail: new Float32Array(TRAIL_MAX * 3),
    trailHead: 0,
    trailLen: 0,
    stamp: 0,
  };
}

export function resetLiveSpin(l: LiveSpin): void {
  l.turns = 0;
  l.phase = 0;
  l.stage = 0;
  l.flash = -10;
  l.trail.fill(0);
  l.trailHead = 0;
  l.trailLen = 0;
}

export function pushTrail(l: LiveSpin): void {
  const i = l.trailHead * 3;
  l.trail[i] = l.bloch[0];
  l.trail[i + 1] = l.bloch[1];
  l.trail[i + 2] = l.bloch[2];
  l.trailHead = (l.trailHead + 1) % TRAIL_MAX;
  if (l.trailLen < TRAIL_MAX) l.trailLen += 1;
}

/** The singleton written by the bench and read by the sphere. */
export const liveSpin: LiveSpin = createLiveSpin();

/* ------------------------------------------------------------------ */
/* Beam-count accumulator                                              */
/* ------------------------------------------------------------------ */

export interface Counter {
  /** Exit-channel hit counts, keyed by the ±1 path signature ("1,-1"). */
  counts: Map<string, number>;
  /** Atoms fired so far in this histogram. */
  shots: number;
  /** Atoms that reached a detector (survived every beam block). */
  detected: number;
  /** Completed shot batches — also the seed offset, so a reroll is reproducible. */
  cycle: number;
  /** Histogram length before the counter restarts. */
  maxShots: number;
}

export function createCounter(keys: string[]): Counter {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, 0);
  return { counts, shots: 0, detected: 0, cycle: 0, maxShots: 0 };
}

export function resetCounter(c: Counter, keys: string[]): void {
  c.counts.clear();
  for (const k of keys) c.counts.set(k, 0);
  c.shots = 0;
  c.detected = 0;
  c.cycle = 0;
}

/** Add one Monte-Carlo batch, creating any channel key the chain just gained. */
export function mergeShot(
  c: Counter,
  s: { counts: Map<string, number>; shots: number; detected: number },
): void {
  for (const [k, v] of s.counts) c.counts.set(k, (c.counts.get(k) ?? 0) + v);
  c.shots += s.shots;
  c.detected += s.detected;
  c.cycle += 1;
}
