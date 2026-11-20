/**
 * chain.ts — turns the flat parameter map into a Stern–Gerlach analyser chain.
 *
 * One function feeds the bench renderer, the Bloch sphere, the statistics tab and
 * the telemetry pill, so the probabilities drawn as beam thicknesses are the same
 * numbers the engine derives from the projectors P± = (I ± σ·n̂)/2.
 *
 * Larmor precession lives in the gaps: with a guide field B along ẑ the spinor
 * rotates about ẑ by φ = γ_e·B·t. Real flight times give thousands of turns, so
 * the animation carries a *display* phase (0 = no field, one turn per
 * 1/`precessionFreq` seconds at the reference field), and the honest SI number is
 * reported next to the slow-motion factor.
 */

import {
  axisVector,
  blochVector,
  malus,
  normalizeSpinor,
  runAnalyzerChain,
  sampleChain,
  spinEigenstates,
  spinorFromAngles,
  v3,
  vDot,
  vNormalize,
  type AnalyzerStage,
  type AxisKind,
  type ChainResult,
  type Spinor,
  type Vec3,
} from '@/engine/physics/blochSpin';
import { pBool, pNum, pStr } from '@/store/useSimStore';
import type { SimParams } from '@/simulations/types';

/** Electron gyromagnetic ratio, rad·s⁻¹ per tesla (|g_e|μ_B/ħ, spin only). */
export const GAMMA_E_RAD_S_T = 1.760890041e11;
/** Typical time of flight through the field region: 2 cm at 500 m/s. */
export const FLIGHT_TIME_S = 4e-5;
/** Guide field (mT) that makes the display clock run at exactly `precessionFreq`. */
export const REFERENCE_MT = 20;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export interface SGStage {
  kind: AxisKind;
  axis: Vec3;
  blockUp: boolean;
  blockDown: boolean;
  label: string;
  azDeg: number;
  elDeg: number;
}

export interface SGModel {
  /** Number of analysers in the chain, 1…3. */
  count: number;
  stages: SGStage[];
  /** Prepared input spinor |χ⟩ = cos(θ/2)|↑⟩ + e^{iφ}sin(θ/2)|↓⟩. */
  input: Spinor;
  thetaDeg: number;
  phiDeg: number;
  /** Bloch vector of the prepared state. */
  bloch: Vec3;
  /** Guide field in mT and the display precession rate in Hz. */
  larmorMT: number;
  precessionHz: number;
  /** True Larmor angular frequency, rad·s⁻¹, for that field. */
  omegaLarmor: number;
  /** True accumulated precession angle over one flight, rad. */
  trueAngleRad: number;
  /** How much the animation stretches time relative to that. */
  slowMotion: number;
  beamCount: number;
  magnetGap: number;
  gradient: number;
  showBloch: boolean;
  showTrajectories: boolean;
  render: string;
  /** Axis of the analyser that actually receives the beam first, for the header. */
  firstAxis: Vec3;
}

export const channelKey = (path: number[]): string => path.join(',');

export const portLabel = (path: number[]): string =>
  path.map((s) => (s === 1 ? '+' : '−')).join('/');

/** Normalise the `stages` slider into 1…3 integer analysers. */
export const stageCount = (p: SimParams): number =>
  Math.max(1, Math.min(3, Math.round(pNum(p, 'stages', 3))));

export function stageKind(p: SimParams, i: number): AxisKind {
  const raw = pStr(p, `a${i}Axis`, 'z');
  return raw === 'x' || raw === 'y' || raw === 'z' || raw === 'custom' ? raw : 'z';
}

export function buildModel(p: SimParams): SGModel {
  const count = stageCount(p);
  const stages: SGStage[] = [];
  for (let i = 1; i <= count; i++) {
    const kind = stageKind(p, i);
    const azDeg = pNum(p, `a${i}CustomAz`, 0);
    const elDeg = pNum(p, `a${i}CustomEl`, 45);
    const axis = vNormalize(axisVector(kind, azDeg, elDeg));
    stages.push({
      kind,
      axis,
      azDeg,
      elDeg,
      blockUp: pBool(p, `block${i}Up`, false),
      blockDown: pBool(p, `block${i}Down`, false),
      label: `SG${i}:${kind === 'custom' ? `(${azDeg.toFixed(0)}°,${elDeg.toFixed(0)}°)` : kind}`,
    });
  }
  const thetaDeg = Math.max(0, Math.min(180, pNum(p, 'spinTheta', 0)));
  const phiDeg = pNum(p, 'spinPhi', 0);
  const input = normalizeSpinor(spinorFromAngles(thetaDeg * DEG, phiDeg * DEG));
  const larmorMT = Math.max(0, pNum(p, 'larmor', 0));
  const precessionHz = Math.max(0.02, pNum(p, 'precessionFreq', 1));
  const omegaLarmor = (GAMMA_E_RAD_S_T * larmorMT) / 1000;
  const trueAngleRad = omegaLarmor * FLIGHT_TIME_S;
  // Display: one full turn per 1/precessionHz seconds when B = REFERENCE_MT.
  const displayRate = TAU * precessionHz * (larmorMT / REFERENCE_MT);
  const slowMotion =
    trueAngleRad > 1e-9 && displayRate > 1e-12 ? trueAngleRad / displayRate : Infinity;

  return {
    count,
    stages,
    input,
    thetaDeg,
    phiDeg,
    bloch: blochVector(input),
    larmorMT,
    precessionHz,
    omegaLarmor,
    trueAngleRad,
    slowMotion,
    beamCount: Math.max(0, Math.round(pNum(p, 'beamCount', 900))),
    magnetGap: pNum(p, 'magnetGap', 0.5),
    gradient: pNum(p, 'fieldGradient', 1),
    showBloch: pBool(p, 'showBloch', true),
    showTrajectories: pBool(p, 'showTrajectories', true),
    render: pStr(p, 'render', 'both'),
    firstAxis: stages[0]?.axis ?? v3(0, 0, 1),
  };
}

/**
 * Engine stages for a given accumulated display phase `turns` (in full turns):
 * analyser i is fed the spinor that precessed by i·2π·turns about ẑ since the
 * source, which is exactly what a longer flight time buys you.
 */
export function analyzerStages(m: SGModel, turns: number): AnalyzerStage[] {
  return m.stages.map((s, i) => ({
    axis: s.axis,
    blockUp: s.blockUp,
    blockDown: s.blockDown,
    label: s.label,
    larmorAxis: i > 0 ? v3(0, 0, 1) : undefined,
    larmorAngle: i > 0 ? TAU * turns * i : 0,
  }));
}

export function chainAt(m: SGModel, turns: number): ChainResult {
  return runAnalyzerChain(m.input, analyzerStages(m, turns));
}

export interface Shot {
  counts: Map<string, number>;
  shots: number;
  detected: number;
}

/**
 * Monte-Carlo run of `count` atoms (default: `beamCount`) — deterministic in
 * (params, seed). The bench fires the beam in small batches so the histogram
 * fills up on screen instead of all at once.
 */
export function shoot(m: SGModel, turns: number, seed: number, count?: number): Shot {
  const n = count === undefined ? m.beamCount : Math.max(0, Math.round(count));
  const res = sampleChain(m.input, analyzerStages(m, turns), n, seed);
  return { counts: res.counts, shots: res.shots, detected: res.detected };
}

/** The same chain with every beam block removed — the full binary splitting tree. */
export function openChainAt(m: SGModel, turns: number): ChainResult {
  return runAnalyzerChain(
    m.input,
    analyzerStages(m, turns).map((s) => ({ ...s, blockUp: false, blockDown: false })),
  );
}

/** Bloch vector of the spinor leaving a given exit channel (empty for no ray). */
export function rayBloch(chain: ChainResult, path: number[]): Vec3 | null {
  const key = channelKey(path);
  const ray = chain.rays.find((r) => channelKey(r.path) === key);
  return ray ? blochVector(ray.state) : null;
}

/** Malus transmission between each consecutive pair of analyser axes. */
export function malusChain(m: SGModel): { from: string; to: string; angleDeg: number; t: number }[] {
  const out: { from: string; to: string; angleDeg: number; t: number }[] = [];
  for (let i = 1; i < m.count; i++) {
    const a = m.stages[i - 1].axis;
    const b = m.stages[i].axis;
    const dot = Math.max(-1, Math.min(1, vDot(a, b)));
    out.push({
      from: m.stages[i - 1].label,
      to: m.stages[i].label,
      angleDeg: (Math.acos(dot) * 180) / Math.PI,
      t: malus(a, b),
    });
  }
  return out;
}

/** The two eigen-spinors of an analyser axis, for the Bloch sphere ports. */
export function analyserPorts(axis: Vec3): [Spinor, Spinor] {
  return spinEigenstates(axis);
}

/** Precession phase in [0,1) turns from a wall-clock second count. */
export function turnsAt(seconds: number, m: SGModel): number {
  const rate = m.precessionHz * (m.larmorMT / REFERENCE_MT);
  const t = seconds * rate;
  return t - Math.floor(t);
}
