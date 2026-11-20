/**
 * Orbitalis 3D — detector tally.
 *
 * The measurement engine fires thousands of position clicks per second. Streaming
 * those into the URL-synced store would thrash the router, so the accumulated
 * histograms live here instead: the canvas writes, the Plots tab reads on a timer.
 * Everything is plain numbers — no React, no DOM, SSR-safe.
 */

export const RADIAL_BINS = 40;
export const AXIS_BINS = 40;

export interface DetectorStats {
  /** |r| histogram of position detections (counts, not probability). */
  radial: Float32Array;
  /** z-coordinate histogram, symmetric range. */
  z: Float32Array;
  /** Collapse outcomes keyed by "n,l,m" → count. */
  collapses: Map<string, number>;
  /** Largest |r| seen, used to scale the histogram axis. */
  rMax: number;
  /** Largest |z| seen. */
  zMax: number;
  total: number;
  version: number;
}

export const detector: DetectorStats = {
  radial: new Float32Array(RADIAL_BINS),
  z: new Float32Array(AXIS_BINS),
  collapses: new Map(),
  rMax: 1,
  zMax: 1,
  total: 0,
  version: 0,
};

export function resetDetector() {
  detector.radial.fill(0);
  detector.z.fill(0);
  detector.collapses.clear();
  detector.rMax = 1;
  detector.zMax = 1;
  detector.total = 0;
  detector.version++;
}

/** One Born-rule position click at (x,y,z), clipped to the current box extent. */
export function recordHit(x: number, y: number, z: number, extent: number) {
  const r = Math.hypot(x, y, z);
  const ri = Math.min(RADIAL_BINS - 1, Math.floor((r / extent) * RADIAL_BINS));
  const zi = Math.min(AXIS_BINS - 1, Math.floor(((z + extent) / (2 * extent)) * AXIS_BINS));
  if (ri >= 0) detector.radial[ri] += 1;
  if (zi >= 0) detector.z[zi] += 1;
  if (r > detector.rMax) detector.rMax = r;
  if (Math.abs(z) > detector.zMax) detector.zMax = Math.abs(z);
  detector.total += 1;
  detector.version++;
}

/** One projective energy measurement outcome. */
export function recordCollapse(n: number, l: number, m: number) {
  const key = `${n},${l},${m}`;
  detector.collapses.set(key, (detector.collapses.get(key) ?? 0) + 1);
  detector.version++;
}

/** Radial histogram normalised to its own peak (0..1). */
export function radialSeries(): number[] {
  const { radial } = detector;
  let peak = 1e-9;
  for (let i = 0; i < RADIAL_BINS; i++) if (radial[i] > peak) peak = radial[i];
  const p = new Array<number>(RADIAL_BINS);
  for (let i = 0; i < RADIAL_BINS; i++) p[i] = radial[i] / peak;
  return p;
}

export function collapseCounts(): [string, number][] {
  return [...detector.collapses.entries()].sort((a, b) => b[1] - a[1]);
}
