/**
 * blochSpin.ts — the shared two-level (spin-½) engine.
 *
 * Everything here is pure TypeScript in a fixed basis `{|↑z⟩, |↓z⟩}` so it can be
 * unit tested with plain `node`, reused by the Stern–Gerlach bench, the Bloch
 * sphere and any future spin simulation.
 *
 *   |χ⟩ = a|↑⟩ + b|↓⟩,  |a|² + |b|² = 1
 *   σx = [[0,1],[1,0]]  σy = [[0,−i],[i,0]]  σz = [[1,0],[0,−1]]
 *   R(n̂,θ) = exp(−i θ σ·n̂ / 2) = cos(θ/2) I − i sin(θ/2) (σ·n̂)
 *   P±(n̂) = (I ± σ·n̂)/2
 *   ⟨σ·n̂⟩ = r · n̂   with   r = (2Re a*b, 2Im a*b, |a|²−|b|²)  (Bloch vector)
 *
 * Conventions
 * -----------
 * • Angles handed to `rotationMatrix` / `precess` are in radians.
 * • Measurement axes are plain `[x, y, z]` unit vectors; they are normalised
 *   defensively because the UI feeds them straight out of sliders.
 * • All functions are pure: they never mutate their arguments.
 */

import type { Complex } from './constants';
import { cAdd, cConj, cMul, cScale, cx } from './constants';

/* ------------------------------------------------------------------ */
/* Small vector helpers (kept local — no dependency on three.js)        */
/* ------------------------------------------------------------------ */

export type Vec3 = [number, number, number];

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];

export function vAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vScale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vLen(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Unit vector, or `fallback` when the input is degenerate. */
export function vNormalize(a: Vec3, fallback: Vec3 = v3(0, 0, 1)): Vec3 {
  const l = vLen(a);
  if (l < 1e-12) return fallback;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Spherical angles (radians) → unit vector, physics convention. */
export function vFromSpherical(theta: number, phi: number): Vec3 {
  const st = Math.sin(theta);
  return [st * Math.cos(phi), st * Math.sin(phi), Math.cos(theta)];
}

/* ------------------------------------------------------------------ */
/* 2×2 complex matrices                                                */
/* ------------------------------------------------------------------ */

export interface Mat2 {
  e00: Complex;
  e01: Complex;
  e10: Complex;
  e11: Complex;
}

export const mat = (
  a00: Complex,
  a01: Complex,
  a10: Complex,
  a11: Complex,
): Mat2 => ({ e00: a00, e01: a01, e10: a10, e11: a11 });

export const ZERO2: Mat2 = mat(cx(0), cx(0), cx(0), cx(0));
export const ID2: Mat2 = mat(cx(1), cx(0), cx(0), cx(1));
export const SIGMA_X: Mat2 = mat(cx(0), cx(1), cx(1), cx(0));
export const SIGMA_Y: Mat2 = mat(cx(0), cx(0, -1), cx(0, 1), cx(0));
export const SIGMA_Z: Mat2 = mat(cx(1), cx(0), cx(0), cx(-1));

export const PAULI: readonly [Mat2, Mat2, Mat2] = [SIGMA_X, SIGMA_Y, SIGMA_Z];

export function matAdd(a: Mat2, b: Mat2): Mat2 {
  return mat(
    cAdd(a.e00, b.e00),
    cAdd(a.e01, b.e01),
    cAdd(a.e10, b.e10),
    cAdd(a.e11, b.e11),
  );
}

export function matScaleC(a: Mat2, s: Complex): Mat2 {
  return mat(
    cMul(a.e00, s),
    cMul(a.e01, s),
    cMul(a.e10, s),
    cMul(a.e11, s),
  );
}

export function matScale(a: Mat2, s: number): Mat2 {
  return mat(
    cScale(a.e00, s),
    cScale(a.e01, s),
    cScale(a.e10, s),
    cScale(a.e11, s),
  );
}

export function matMul(a: Mat2, b: Mat2): Mat2 {
  return mat(
    cAdd(cMul(a.e00, b.e00), cMul(a.e01, b.e10)),
    cAdd(cMul(a.e00, b.e01), cMul(a.e01, b.e11)),
    cAdd(cMul(a.e10, b.e00), cMul(a.e11, b.e10)),
    cAdd(cMul(a.e10, b.e01), cMul(a.e11, b.e11)),
  );
}

export function matHermitian(a: Mat2): Mat2 {
  return mat(cConj(a.e00), cConj(a.e10), cConj(a.e01), cConj(a.e11));
}

/** Trace of a 2×2 matrix as a complex number. */
export function matTrace(a: Mat2): Complex {
  return cAdd(a.e00, a.e11);
}

/** Largest absolute deviation from another matrix — used by the unit checks. */
export function matDistance(a: Mat2, b: Mat2): number {
  return Math.max(
    Math.hypot(a.e00.re - b.e00.re, a.e00.im - b.e00.im),
    Math.hypot(a.e01.re - b.e01.re, a.e01.im - b.e01.im),
    Math.hypot(a.e10.re - b.e10.re, a.e10.im - b.e10.im),
    Math.hypot(a.e11.re - b.e11.re, a.e11.im - b.e11.im),
  );
}

/** σ·n̂ for a (normalised) direction n̂. */
export function sigmaDot(nRaw: Vec3): Mat2 {
  const n = vNormalize(nRaw);
  return matAdd(
    matAdd(matScale(SIGMA_X, n[0]), matScale(SIGMA_Y, n[1])),
    matScale(SIGMA_Z, n[2]),
  );
}

/* ------------------------------------------------------------------ */
/* Spinors                                                             */
/* ------------------------------------------------------------------ */

/** A normalised-or-not two-component spinor (a = ↑ amplitude, b = ↓ amplitude). */
export interface Spinor {
  up: Complex;
  down: Complex;
}

export const spinor = (up: Complex, down: Complex): Spinor => ({ up, down });

export const SPIN_UP_Z: Spinor = spinor(cx(1), cx(0));
export const SPIN_DOWN_Z: Spinor = spinor(cx(0), cx(1));

export function spinorAdd(a: Spinor, b: Spinor): Spinor {
  return spinor(cAdd(a.up, b.up), cAdd(a.down, b.down));
}

export function spinorScaleC(a: Spinor, s: Complex): Spinor {
  return spinor(cMul(a.up, s), cMul(a.down, s));
}

export function spinorNorm2(s: Spinor): number {
  return s.up.re * s.up.re + s.up.im * s.up.im + s.down.re * s.down.re + s.down.im * s.down.im;
}

export function spinorNorm(s: Spinor): number {
  return Math.sqrt(spinorNorm2(s));
}

/** Return a unit-length copy; the zero spinor is passed through untouched. */
export function normalizeSpinor(s: Spinor): Spinor {
  const n = spinorNorm(s);
  if (n < 1e-15) return s;
  return spinor(cScale(s.up, 1 / n), cScale(s.down, 1 / n));
}

/** ⟨χ|φ⟩ (conjugate-linear in the first argument). */
export function spinorInner(a: Spinor, b: Spinor): Complex {
  return cAdd(cMul(cConj(a.up), b.up), cMul(cConj(a.down), b.down));
}

/** |χ⟩ = cos(θ/2)|↑⟩ + e^{iφ} sin(θ/2)|↓⟩. */
export function spinorFromAngles(theta: number, phi: number): Spinor {
  const c = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return spinor(cx(c, 0), cx(s * Math.cos(phi), s * Math.sin(phi)));
}

/**
 * Bloch angles of a spinor. The global phase is stripped first, so the result is
 * unique up to the usual 2π wrap and always yields θ ∈ [0, π].
 */
export function anglesFromSpinor(sRaw: Spinor): { theta: number; phi: number } {
  const s = normalizeSpinor(sRaw);
  const nUp = Math.hypot(s.up.re, s.up.im);
  if (nUp < 1e-12) return { theta: Math.PI, phi: 0 };
  if (Math.hypot(s.down.re, s.down.im) < 1e-12) return { theta: 0, phi: 0 };
  // Remove the phase of the ↑ amplitude: cos(θ/2) then becomes real ≥ 0.
  const gate = { re: s.up.re / nUp, im: -s.up.im / nUp };
  const down = cMul(s.down, gate);
  const theta = 2 * Math.acos(Math.max(-1, Math.min(1, nUp)));
  return { theta, phi: Math.atan2(down.im, down.re) };
}

/** Bloch vector r = ⟨σ⟩. Unit length for a pure state. */
export function blochVector(s: Spinor): Vec3 {
  const n2 = spinorNorm2(s);
  if (n2 < 1e-15) return [0, 0, 0];
  const inv = 1 / n2;
  const cross = cMul(cConj(s.up), s.down);
  return [
    (2 * cross.re) * inv,
    (2 * cross.im) * inv,
    ((s.up.re * s.up.re + s.up.im * s.up.im) -
      (s.down.re * s.down.re + s.down.im * s.down.im)) *
      inv,
  ];
}

/** ⟨χ|σ·n̂|χ⟩, a real number in [−1, 1] for a normalised spinor. */
export function expectationSpin(s: Spinor, nRaw: Vec3): number {
  const n = vNormalize(nRaw);
  const r = blochVector(s);
  return vDot(r, n);
}

/** ⟨χ|O|χ⟩ for any 2×2 operator. */
export function expectationMatrix(s: Spinor, o: Mat2): Complex {
  const oS = applyMat2(s, o);
  return spinorInner(s, oS);
}

export function applyMat2(s: Spinor, m: Mat2): Spinor {
  return spinor(
    cAdd(cMul(m.e00, s.up), cMul(m.e01, s.down)),
    cAdd(cMul(m.e10, s.up), cMul(m.e11, s.down)),
  );
}

/* ------------------------------------------------------------------ */
/* SU(2) rotations, projectors, measurement                             */
/* ------------------------------------------------------------------ */

/**
 * R(n̂, θ) = exp(−i θ σ·n̂ / 2) = cos(θ/2) I − i sin(θ/2) σ·n̂.
 * Closed form, therefore exact for every θ (no series truncation).
 */
export function rotationMatrix(nRaw: Vec3, theta: number): Mat2 {
  const n = vNormalize(nRaw);
  const half = theta / 2;
  const c = Math.cos(half);
  const s = Math.sin(half);
  return matAdd(matScale(ID2, c), matScaleC(sigmaDot(n), cx(0, -s)));
}

/** Apply R(n̂, θ) to a spinor. */
export function rotateSpinor(s: Spinor, nRaw: Vec3, theta: number): Spinor {
  return applyMat2(s, rotationMatrix(nRaw, theta));
}

/**
 * Larmor precession: a spin in a static field along n̂ evolves as
 * |χ(t)⟩ = exp(−i ω_L t σ·n̂ / 2)|χ(0)⟩, i.e. the Bloch vector sweeps by
 * ω_L t about n̂. `angle` is ω_L t in radians.
 */
export function precess(s: Spinor, nRaw: Vec3, angle: number): Spinor {
  return rotateSpinor(s, nRaw, angle);
}

/** P±(n̂) = (I ± σ·n̂)/2 — the Stern–Gerlach filter for one output beam. */
export function projector(nRaw: Vec3, sign: 1 | -1): Mat2 {
  const p = matAdd(ID2, matScale(sigmaDot(nRaw), sign));
  return matScale(p, 0.5);
}

/**
 * Born-rule weight of an SG channel *without* renormalising the state — this is
 * the probability the analyser transmits into that output port.
 */
export function channelProbability(s: Spinor, nRaw: Vec3, sign: 1 | -1): number {
  const projected = applyMat2(s, projector(nRaw, sign));
  return spinorNorm2(projected);
}

export interface MeasurementResult {
  /** +1 = "up" port of the analyser, −1 = "down" port. */
  outcome: 1 | -1;
  /** Probability of the outcome that was realised. */
  probability: number;
  /** Normalised post-measurement spinor (an eigenstate of σ·n̂). */
  collapsed: Spinor;
  /** Probability of the *other* outcome, handy for the HUD. */
  otherProbability: number;
  /** The un-renormalised projected spinor before collapse. */
  projected: Spinor;
}

/**
 * Projective measurement of σ·n̂ on |χ⟩.
 * `force` pins the outcome (used by the deterministic demo tours and the unit
 * checks); otherwise the branch is sampled with `rng`.
 */
export function measureSpin(
  s: Spinor,
  nRaw: Vec3,
  opts: { rng?: () => number; force?: 1 | -1 } = {},
): MeasurementResult {
  const pUp = channelProbability(s, nRaw, 1);
  const pDown = channelProbability(s, nRaw, -1);
  const total = pUp + pDown;
  const norm = total > 1e-15 ? total : 1;
  const outcome: 1 | -1 =
    opts.force ?? (opts.rng ? (opts.rng() * norm < pUp ? 1 : -1) : pUp >= pDown ? 1 : -1);
  const projected = applyMat2(s, projector(nRaw, outcome));
  const weight = outcome === 1 ? pUp : pDown;
  return {
    outcome,
    probability: weight / norm,
    collapsed: normalizeSpinor(projected),
    otherProbability: (outcome === 1 ? pDown : pUp) / norm,
    projected,
  };
}

/** Eigen-spinors of σ·n̂: (eigenvalue +1, eigenvalue −1). */
export function spinEigenstates(nRaw: Vec3): [Spinor, Spinor] {
  const n = vNormalize(nRaw);
  // |+_n⟩ = (cos(ϑ/2), e^{iφ} sin(ϑ/2)); use the stable half-angle form and
  // fall back to a phase-fixed construction near the south pole.
  const theta = Math.acos(Math.max(-1, Math.min(1, n[2])));
  const phi = Math.atan2(n[1], n[0]);
  const plus = spinorFromAngles(theta, phi);
  // Orthogonal partner: |−_n⟩ = (−e^{−iφ}sin(ϑ/2), cos(ϑ/2)) up to a phase.
  const minus = spinor(
    cx(-Math.sin(theta / 2) * Math.cos(-phi), -Math.sin(theta / 2) * Math.sin(-phi)),
    cx(Math.cos(theta / 2), 0),
  );
  return [plus, normalizeSpinor(minus)];
}

/* ------------------------------------------------------------------ */
/* Stern–Gerlach analyser chains                                       */
/* ------------------------------------------------------------------ */

export type AxisKind = 'x' | 'y' | 'z' | 'custom';

export const AXIS_VECTORS: Record<'x' | 'y' | 'z', Vec3> = {
  x: v3(1, 0, 0),
  y: v3(0, 1, 0),
  z: v3(0, 0, 1),
};

/**
 * Analyser quantisation axis. `azDeg`/`elDeg` are only consulted for
 * `kind === 'custom'`: az sweeps in the xy-plane, el lifts toward +z.
 */
export function axisVector(kind: AxisKind, azDeg = 0, elDeg = 0): Vec3 {
  if (kind === 'x') return AXIS_VECTORS.x;
  if (kind === 'y') return AXIS_VECTORS.y;
  if (kind === 'z') return AXIS_VECTORS.z;
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return vFromSpherical(Math.PI / 2 - el, az);
}

export interface AnalyzerStage {
  axis: Vec3;
  blockUp: boolean;
  blockDown: boolean;
  /** Optional Larmor rotation about `larmorAxis` applied on the way in. */
  larmorAxis?: Vec3;
  larmorAngle?: number;
  label?: string;
}

export interface BeamRay {
  /** Path history, one entry per stage: +1 or −1 (port taken). */
  path: number[];
  weight: number;
  state: Spinor;
  /** Weight of each port *before* the block, per stage. */
  split: number[];
}

export interface StageStatistics {
  /** Total weight arriving at this analyser (sum over incoming rays). */
  incident: number;
  up: number;
  down: number;
  /** Weight actually leaving the analyser after the beam blocks. */
  transmitted: number;
}

export interface ChainResult {
  rays: BeamRay[];
  stages: StageStatistics[];
  incident: number;
  transmitted: number;
  blocked: number;
  /** Exit-channel weights keyed by the ±1 path signature, e.g. "1,-1". */
  channels: { path: number[]; probability: number }[];
  /** Input spinor, normalised. */
  input: Spinor;
}

/**
 * Sequential Stern–Gerlach measurement with optional beam blocks.
 *
 * Each analyser performs a projective measurement along its own axis: a ray of
 * weight w splits into two rays of weights w·|P±χ|², each carrying the collapsed
 * (renormalised) spinor. Blocked ports delete their ray, which is exactly the
 * "erased knowledge" physics of the classic three-magnet experiment.
 */
export function runAnalyzerChain(input: Spinor, stages: AnalyzerStage[]): ChainResult {
  const start = normalizeSpinor(input);
  let rays: BeamRay[] = [
    { path: [], weight: spinorNorm2(start), state: start, split: [] },
  ];
  const stats: StageStatistics[] = [];

  for (const stage of stages) {
    const axis = vNormalize(stage.axis);
    const incident = rays.reduce((s, r) => s + r.weight, 0);
    let up = 0;
    let down = 0;
    const next: BeamRay[] = [];
    for (const ray of rays) {
      let state = ray.state;
      if (stage.larmorAxis && stage.larmorAngle) {
        state = precess(state, stage.larmorAxis, stage.larmorAngle);
      }
      const pUp = channelProbability(state, axis, 1);
      const pDown = channelProbability(state, axis, -1);
      up += ray.weight * pUp;
      down += ray.weight * pDown;
      if (pUp > 1e-12 && !stage.blockUp) {
        next.push({
          path: [...ray.path, 1],
          weight: ray.weight * pUp,
          state: normalizeSpinor(applyMat2(state, projector(axis, 1))),
          split: [...ray.split, pUp],
        });
      }
      if (pDown > 1e-12 && !stage.blockDown) {
        next.push({
          path: [...ray.path, -1],
          weight: ray.weight * pDown,
          state: normalizeSpinor(applyMat2(state, projector(axis, -1))),
          split: [...ray.split, pDown],
        });
      }
    }
    const transmitted = next.reduce((s, r) => s + r.weight, 0);
    stats.push({ incident, up, down, transmitted });
    rays = next;
  }

  const channelMap = new Map<string, number>();
  for (const ray of rays) channelMap.set(ray.path.join(','), (channelMap.get(ray.path.join(',')) ?? 0) + ray.weight);
  const channels = [...channelMap.entries()]
    .map(([key, probability]) => ({ path: key.split(',').map(Number), probability }))
    .sort((a, b) => b.probability - a.probability);

  const total = spinorNorm2(start);
  const out = rays.reduce((s, r) => s + r.weight, 0);
  return {
    rays,
    stages: stats,
    incident: total,
    transmitted: out,
    blocked: Math.max(0, total - out),
    channels,
    input: start,
  };
}

/**
 * Monte-Carlo shot noise for the beam counter: fires `count` independent atoms
 * through the same chain and returns the exit-channel hit counts.
 * Deterministic given the seed, so a permalink reproduces a histogram exactly.
 */
export function sampleChain(
  input: Spinor,
  stages: AnalyzerStage[],
  count: number,
  seed = 0x2f6e2b1,
): { counts: Map<string, number>; shots: number; detected: number } {
  let state = 0x2f6e2b1 ^ Math.imul(seed, 0x1b873593);
  const rng = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const counts = new Map<string, number>();
  const chain = runAnalyzerChain(input, stages);
  for (const ch of chain.channels) counts.set(ch.path.join(','), 0);

  const n = Math.max(0, Math.round(count));
  let detected = 0;
  for (let i = 0; i < n; i++) {
    let spin = normalizeSpinor(input);
    const path: number[] = [];
    for (const stage of stages) {
      const axis = vNormalize(stage.axis);
      if (stage.larmorAxis && stage.larmorAngle) spin = precess(spin, stage.larmorAxis, stage.larmorAngle);
      const res = measureSpin(spin, axis, { rng });
      if (res.outcome === 1 && stage.blockUp) {
        path.length = 0;
        break;
      }
      if (res.outcome === -1 && stage.blockDown) {
        path.length = 0;
        break;
      }
      path.push(res.outcome);
      spin = res.collapsed;
    }
    if (!path.length) continue;
    const key = path.join(',');
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      detected += 1;
    }
  }
  return { counts, shots: n, detected };
}

/* ------------------------------------------------------------------ */
/* Malus law for spin-½                                               */
/* ------------------------------------------------------------------ */

/**
 * Transmission of a σ·m̂ filter fed by a σ·n̂ eigenstate: cos²(γ/2) where γ is
 * the angle between the analysers. This is the spin-½ Malus law.
 */
export function malus(nRaw: Vec3, mRaw: Vec3): number {
  const c = Math.max(-1, Math.min(1, vDot(vNormalize(nRaw), vNormalize(mRaw))));
  return 0.5 * (1 + c);
}

/** Angle (radians) between two directions, clipped for numeric safety. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const c = Math.max(-1, Math.min(1, vDot(vNormalize(a), vNormalize(b))));
  return Math.acos(c);
}
