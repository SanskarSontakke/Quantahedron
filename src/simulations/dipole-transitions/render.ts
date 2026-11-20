/**
 * render.ts — all Canvas2D painting for the Dipole Transitions stage.
 *
 * Kept free of React: the simulation clock calls these with a live context, so a
 * frame costs a few tens of thousands of float ops and never allocates.
 */

import { label, plotFrame, plotGrid } from '@/components/ui/PlotCanvas';
import { densityPhaseColor, phaseToUnit, rgbCss } from '@/lib/colorMap';
import { wavelengthToRGB } from '@/engine/physics/constants';
import type { AtomNumbers } from './physics';

/* ------------------------------- state bags ------------------------------- */

export interface CloudProfiles {
  size: number;
  extent: number;
  iRe: Float32Array;
  iIm: Float32Array;
  fRe: Float32Array;
  fIm: Float32Array;
  peak: number;
}

export interface LiveAtom {
  /** Rotating-frame envelopes b_i, b_f. */
  biRe: number;
  biIm: number;
  bfRe: number;
  bfIm: number;
  /** Slow-motion optical phase −ω₁₂·τ (radians). */
  optPhase: number;
  /** Physical time since reset, ns. */
  tNs: number;
  p1: number;
  p2: number;
  u: number;
  v: number;
  w: number;
  /** ⟨d⟩ in e·a₀. */
  dipole: number;
  pulseArea: number;
  subSteps: number;
  method: 'rk4' | 'exact';
  /** Bloch trajectory ring buffer (x, y, z triples) with a write head. */
  trail: Float32Array;
  trailHead: number;
  trailLen: number;
}

export function createLive(trailLen = 220): LiveAtom {
  return {
    biRe: 1,
    biIm: 0,
    bfRe: 0,
    bfIm: 0,
    optPhase: 0,
    tNs: 0,
    p1: 1,
    p2: 0,
    u: 0,
    v: 0,
    w: 1,
    dipole: 0,
    pulseArea: 0,
    subSteps: 1,
    method: 'rk4',
    trail: new Float32Array(trailLen * 3),
    trailHead: 0,
    trailLen,
  };
}

export function pushTrail(l: LiveAtom): void {
  const i = l.trailHead * 3;
  l.trail[i] = l.u;
  l.trail[i + 1] = l.v;
  l.trail[i + 2] = l.w;
  l.trailHead = (l.trailHead + 1) % l.trailLen;
}

/* -------------------------------- history -------------------------------- */

export interface History {
  cap: number;
  t: Float64Array;
  p1: Float64Array;
  p2: Float64Array;
  /** Analytic (undamped) reference population. */
  ref: Float64Array;
  len: number;
  head: number;
}

export function createHistory(cap = 720): History {
  return {
    cap,
    t: new Float64Array(cap),
    p1: new Float64Array(cap),
    p2: new Float64Array(cap),
    ref: new Float64Array(cap),
    len: 0,
    head: 0,
  };
}

export function pushHistory(h: History, t: number, p1: number, p2: number, ref: number): void {
  h.t[h.head] = t;
  h.p1[h.head] = p1;
  h.p2[h.head] = p2;
  h.ref[h.head] = ref;
  h.head = (h.head + 1) % h.cap;
  if (h.len < h.cap) h.len += 1;
}

export function clearHistory(h: History): void {
  h.len = 0;
  h.head = 0;
}

/** Oldest → newest iteration order. */
export function historyIndex(h: History, k: number): number {
  return (h.head - h.len + k + h.cap * 2) % h.cap;
}

/* ------------------------------ cloud pixels ------------------------------ */

/**
 * Pre-ramped colour table: PHASE_STEPS hues around the wheel × DENSITY_STEPS
 * brightness levels, built once per palette from `densityPhaseColor`. Painting a
 * 120×120 cloud is then 14 400 table lookups instead of 14 400 allocations.
 */
const PHASE_STEPS = 72;
const DENSITY_STEPS = 40;
const LUT = new Map<string, Uint8Array>();

function cloudLut(palette: 'twilight' | 'cividis'): Uint8Array {
  const key = palette;
  const hit = LUT.get(key);
  if (hit) return hit;
  const lut = new Uint8Array(PHASE_STEPS * DENSITY_STEPS * 4);
  for (let p = 0; p < PHASE_STEPS; p++) {
    const angle = (p / PHASE_STEPS) * Math.PI * 2 - Math.PI;
    for (let d = 0; d < DENSITY_STEPS; d++) {
      const dens = d / (DENSITY_STEPS - 1);
      const c = densityPhaseColor(angle, dens, palette, 1.15, 2.4);
      const o = (p * DENSITY_STEPS + d) * 4;
      lut[o] = Math.round(c.r * 255);
      lut[o + 1] = Math.round(c.g * 255);
      lut[o + 2] = Math.round(c.b * 255);
      lut[o + 3] = Math.round(Math.min(1, c.a * 1.25) * 255);
    }
  }
  LUT.set(key, lut);
  return lut;
}

/**
 * |Ψ(y,z)|² for Ψ = b_i ψ_i + b_f e^{−iω₁₂τ} ψ_f, painted with the twilight
 * phase wheel (arg Ψ → hue) and |Ψ|² → luminance.
 */
export function paintCloud(
  img: ImageData,
  prof: CloudProfiles,
  live: LiveAtom,
  atom: AtomNumbers,
  phaseColor: boolean,
  opacity: number,
  palette: 'twilight' | 'cividis',
): void {
  const n = prof.size * prof.size;
  const data = img.data;
  const lut = cloudLut(palette);
  const cr = Math.cos(live.optPhase);
  const si = Math.sin(live.optPhase);
  const bRe = live.bfRe * cr - live.bfIm * si;
  const bIm = live.bfRe * si + live.bfIm * cr;
  const aRe = live.biRe;
  const aIm = live.biIm;
  const invPeak = 1 / Math.max(1e-12, prof.peak);
  const dScale = (DENSITY_STEPS - 1) * Math.sqrt(invPeak);
  const pScale = PHASE_STEPS / (Math.PI * 2);
  for (let k = 0; k < n; k++) {
    const f1re = prof.iRe[k];
    const f1im = prof.iIm[k];
    const f2re = prof.fRe[k];
    const f2im = prof.fIm[k];
    const re = aRe * f1re - aIm * f1im + bRe * f2re - bIm * f2im;
    const im = aRe * f1im + aIm * f1re + bRe * f2im + bIm * f2re;
    const mag = Math.hypot(re, im) * dScale;
    const dIdx = mag >= DENSITY_STEPS - 1 ? DENSITY_STEPS - 1 : mag < 0 ? 0 : mag | 0;
    const pIdx = phaseColor
      ? ((((Math.atan2(im, re) + Math.PI) * pScale) | 0) % PHASE_STEPS + PHASE_STEPS) % PHASE_STEPS
      : 0;
    const o = (pIdx * DENSITY_STEPS + dIdx) * 4;
    const q = k * 4;
    data[q] = lut[o];
    data[q + 1] = lut[o + 1];
    data[q + 2] = lut[o + 2];
    data[q + 3] = (lut[o + 3] * opacity) | 0;
  }
  void atom;
}

/* ------------------------------ cloud overlay ----------------------------- */

export function drawCloudOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  atom: AtomNumbers,
  live: LiveAtom,
  showField: boolean,
): void {
  const cx = w / 2;
  const cy = h / 2;

  // Nucleus + quantisation axis.
  ctx.save();
  ctx.strokeStyle = 'rgba(148,163,184,0.35)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, 8);
  ctx.lineTo(cx, h - 8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(232,238,252,0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, '+ẑ', cx + 6, 16, 'rgba(148,163,184,0.8)');
  label(ctx, '−ẑ', cx + 6, h - 8, 'rgba(148,163,184,0.8)');
  ctx.restore();

  // The driving field E(t) = E₀ cos(ω_L t) ẑ as an arrow lattice.
  if (showField) {
    const phase = live.optPhase * (atom.laser / Math.max(1e-9, atom.omega0));
    const eNow = Math.cos(phase);
    const rows = 5;
    const cols = 7;
    ctx.save();
    ctx.lineWidth = 1.4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ((c + 0.5) / cols) * w;
        const y = ((r + 0.5) / rows) * h;
        const dx = x - cx;
        const dy = y - cy;
        if (Math.hypot(dx, dy) < Math.min(w, h) * 0.19) continue;
        const len = 13 * eNow * Math.min(1.6, atom.eField / 4e5 + 0.25);
        if (Math.abs(len) < 0.6) continue;
        const col = eNow > 0 ? 'rgba(251,191,36,0.55)' : 'rgba(129,140,248,0.55)';
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(x, y + len);
        ctx.lineTo(x, y - len);
        ctx.stroke();
        const head = y - len;
        const dir = len > 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(x, head);
        ctx.lineTo(x - 2.4, head - 3.4 * dir);
        ctx.moveTo(x, head);
        ctx.lineTo(x + 2.4, head - 3.4 * dir);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ⟨d⟩ badge — the oscillating dipole that radiates.
  const dNorm = atom.absD > 1e-9 ? live.dipole / atom.absD : 0;
  ctx.save();
  const bx = 10;
  const by = h - 30;
  label(ctx, '⟨d⟩ =', bx, by - 12, 'rgba(148,163,184,0.8)', 9.5);
  ctx.strokeStyle = 'rgba(232,238,252,0.75)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(bx + 34, by - 16);
  ctx.lineTo(bx + 34, by - 4);
  ctx.stroke();
  const dx = Math.max(-1, Math.min(1, dNorm)) * 34;
  ctx.strokeStyle = rgbCss({ r: 0.99, g: 0.55, b: 0.55 }, 0.95);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx + 34, by - 10);
  ctx.lineTo(bx + 34 + dx, by - 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx + 34 + dx, by - 10, 3.4, 0, Math.PI * 2);
  ctx.fillStyle = rgbCss({ r: 0.99, g: 0.55, b: 0.55 }, 0.95);
  ctx.fill();
  label(
    ctx,
    `${live.dipole >= 0 ? '+' : ''}${live.dipole.toFixed(2)} e·a₀`,
    bx + 76,
    by - 7,
    'rgba(232,238,252,0.85)',
    10,
  );
  ctx.restore();
}

/* ------------------------------- bloch sphere ----------------------------- */

export interface BlochView {
  az: number;
  el: number;
}

interface Proj {
  x: number;
  y: number;
  depth: number;
}

function project(v: [number, number, number], view: BlochView, cx: number, cy: number, R: number): Proj {
  const ca = Math.cos(view.az);
  const sa = Math.sin(view.az);
  const ce = Math.cos(view.el);
  const se = Math.sin(view.el);
  const x1 = v[0] * ca - v[1] * sa;
  const y1 = v[0] * sa + v[1] * ca;
  const z1 = v[2];
  return {
    x: cx + R * x1,
    y: cy - R * (z1 * ce - y1 * se),
    depth: z1 * se + y1 * ce,
  };
}

export function drawBloch(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  live: LiveAtom,
  atom: AtomNumbers,
  view: BlochView,
  palette: 'twilight' | 'cividis',
): void {
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.38;

  ctx.save();
  // Sphere outline.
  ctx.strokeStyle = 'rgba(148,163,184,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  // Great circles (u–w, v–w, equator) as ellipses in projection.
  const circle = (axis: 'uv' | 'uw' | 'vw', alpha: number) => {
    ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const v: [number, number, number] =
        axis === 'uw'
          ? [Math.cos(a), 0, Math.sin(a)]
          : axis === 'vw'
            ? [0, Math.cos(a), Math.sin(a)]
            : [Math.cos(a), Math.sin(a), 0];
      const pt = project(v, view, cx, cy, R);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  };
  circle('uw', 0.16);
  circle('vw', 0.16);
  circle('uv', 0.22);

  // Axes.
  const axes: [string, [number, number, number], string][] = [
    ['u', [1, 0, 0], 'rgba(94,234,212,0.75)'],
    ['v', [0, 1, 0], 'rgba(129,140,248,0.75)'],
    ['w', [0, 0, 1], 'rgba(232,238,252,0.6)'],
  ];
  for (const [name, vec, col] of axes) {
    const a = project([-vec[0], -vec[1], -vec[2]], view, cx, cy, R);
    const b = project(vec, view, cx, cy, R);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, name, b.x + 4, b.y - 4, col, 10);
  }

  // Precession vector Ω⃗ = (Ω_R, 0, −Δ) normalised to the sphere.
  const mag = Math.hypot(atom.rabi, atom.detuning);
  if (mag > 1e-9) {
    const dir: [number, number, number] = [atom.rabi / mag, 0, -atom.detuning / mag];
    const tip = project(dir, view, cx, cy, R * 0.98);
    ctx.strokeStyle = 'rgba(251,191,36,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    label(ctx, 'Ω⃗', tip.x + 5, tip.y + 4, 'rgba(251,191,36,0.95)', 10);
  }

  // Trajectory.
  ctx.lineWidth = 1.5;
  for (let k = 0; k < live.trailLen; k++) {
    const i0 = (live.trailHead - 1 - k + live.trailLen * 2) % live.trailLen;
    const i1 = (i0 + 1) % live.trailLen;
    const a0 = live.trail[i0 * 3];
    const b0 = live.trail[i0 * 3 + 1];
    const c0 = live.trail[i0 * 3 + 2];
    const a1 = live.trail[i1 * 3];
    const b1 = live.trail[i1 * 3 + 1];
    const c1 = live.trail[i1 * 3 + 2];
    if (a0 === 0 && b0 === 0 && c0 === 0) continue;
    const p0 = project([a0, b0, c0], view, cx, cy, R);
    const p1 = project([a1, b1, c1], view, cx, cy, R);
    const fade = 1 - k / live.trailLen;
    const c = phaseColorCache(phaseToUnit(Math.atan2(b0, a0)), fade, palette);
    ctx.strokeStyle = c;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  // State vector.
  const tip = project([live.u, live.v, live.w], view, cx, cy, R);
  ctx.strokeStyle = 'rgba(251,113,133,0.95)';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.fillStyle = '#fb7185';
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(6,8,13,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();

  label(ctx, `w = ${live.w >= 0 ? '+' : ''}${live.w.toFixed(3)}`, 8, 14, 'rgba(232,238,252,0.8)', 10);
  label(ctx, 'Bloch sphere (u, v, w)', 8, h - 10, 'rgba(148,163,184,0.65)', 9.5);
  ctx.restore();
}

/** Cheap cached colour ramp for the trail (avoids allocating per segment). */
const TRAIL_CACHE = new Map<string, string>();
function phaseColorCache(u: number, fade: number, palette: 'twilight' | 'cividis'): string {
  const key = `${u.toFixed(2)}|${Math.round(fade * 10)}|${palette}`;
  const hit = TRAIL_CACHE.get(key);
  if (hit) return hit;
  const c = densityPhaseColor(u * Math.PI * 2 - Math.PI, 1, palette, 1, 1);
  const val = rgbCss(c, 0.12 + 0.6 * fade);
  if (TRAIL_CACHE.size > 900) TRAIL_CACHE.clear();
  TRAIL_CACHE.set(key, val);
  return val;
}

/* ----------------------------- population plot ---------------------------- */

export function drawPopulations(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hist: History,
  atom: AtomNumbers,
  live: LiveAtom,
): void {
  const pad = { l: 30, r: 8, t: 16, b: 16 };
  plotGrid(ctx, w, h, pad, 4, 6);
  plotFrame(ctx, w, h, pad);

  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let k = 0; k < hist.len; k++) {
    const t = hist.t[historyIndex(hist, k)];
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  if (!Number.isFinite(tMin)) {
    tMin = 0;
    tMax = 1;
  }
  if (tMax - tMin < 1e-9) tMax = tMin + 1e-9;
  const toPx = (t: number, p: number): [number, number] => [
    pad.l + ((t - tMin) / (tMax - tMin)) * iw,
    pad.t + (1 - p) * ih,
  ];

  // Analytic RWA envelope (dashed) then the two integrated populations.
  const line = (get: (idx: number) => number, color: string, width: number, dashed: boolean, alpha: number) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    if (dashed) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let k = 0; k < hist.len; k++) {
      const idx = historyIndex(hist, k);
      const [x, y] = toPx(hist.t[idx], get(idx));
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  };
  line((i) => hist.ref[i], 'rgba(148,163,184,0.85)', 1, true, 0.6);
  line((i) => hist.p1[i], '#5eead4', 1.7, false, 1);
  line((i) => hist.p2[i], '#fb7185', 1.9, false, 1);

  // Marker on the newest sample.
  if (hist.len > 0) {
    const idx = (hist.head - 1 + hist.cap) % hist.cap;
    const [x, y] = toPx(hist.t[idx], hist.p2[idx]);
    ctx.fillStyle = '#fb7185';
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.fillStyle = 'rgba(94,234,212,0.9)';
  ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText('P₁', pad.l + 4, pad.t + 10);
  ctx.fillStyle = 'rgba(251,113,133,0.95)';
  ctx.fillText('P₂', pad.l + 24, pad.t + 10);
  ctx.restore();

  label(ctx, '1', 14, pad.t + 4, 'rgba(148,163,184,0.7)');
  label(ctx, '0', 14, pad.t + ih, 'rgba(148,163,184,0.7)');
  label(ctx, `${tMin.toFixed(tMax - tMin > 10 ? 0 : 3)} ns`, pad.l, h - 4, 'rgba(148,163,184,0.7)', 9);
  label(ctx, `${tMax.toFixed(tMax - tMin > 10 ? 0 : 3)} ns`, w - pad.r - 44, h - 4, 'rgba(148,163,184,0.7)', 9);
  label(
    ctx,
    `Ω_R t = ${live.pulseArea.toFixed(2)} rad`,
    w - pad.r - 96,
    pad.t - 4,
    'rgba(251,191,36,0.9)',
    9.5,
  );
  void atom;
}

/* --------------------------- field / dipole plot -------------------------- */

/**
 * One optical window: the laser field E(t)/E₀ and the atomic dipole ⟨d⟩/d_fi.
 * A driven dipole lags the field by the detuning-dependent phase and its
 * amplitude is 2|b_i b_f| — this is the oscillating charge that radiates.
 */
export function drawFieldDipole(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  atom: AtomNumbers,
  live: LiveAtom,
): void {
  const pad = { l: 26, r: 8, t: 16, b: 14 };
  plotFrame(ctx, w, h, pad, 'rgba(148,163,184,0.25)');
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const mid = pad.t + ih / 2;

  ctx.save();
  ctx.strokeStyle = 'rgba(148,163,184,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, mid);
  ctx.lineTo(w - pad.r, mid);
  ctx.stroke();
  ctx.restore();

  const cycles = 3;
  const N = 220;
  const phase = live.optPhase;
  const omegaRatio = atom.omega0 > 0 ? atom.laser / atom.omega0 : 1;

  const wave = (fn: (u: number) => number, color: string, width: number, dash: boolean) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const tau = u * cycles * 2 * Math.PI; // optical phase variable
      const y = mid - fn(tau + phase) * (ih / 2) * 0.86;
      const x = pad.l + u * iw;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  };

  // E(t)/E₀ = cos(ω_L τ)
  wave((t) => Math.cos(t * omegaRatio), 'rgba(251,191,36,0.95)', 1.6, false);
  // Coherence envelope 2|b_i||b_f| modulates the dipole amplitude. Over one
  // optical window the Rabi amplitude is effectively constant (T_Rabi ≫ T_L),
  // so the envelope is a pair of straight lines at ±2|b_i b_f|.
  const env = Math.min(1, 2 * Math.hypot(live.biRe, live.biIm) * Math.hypot(live.bfRe, live.bfIm));
  ctx.save();
  ctx.strokeStyle = 'rgba(251,113,133,0.28)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  for (const sgn of [1, -1]) {
    const y = mid - sgn * env * (ih / 2) * 0.86;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }
  ctx.restore();
  // ⟨d⟩(t)/d_fi = 2 Re(b_i* b_f e^{−iω₁₂τ})·(d_fi/|d_fi|)
  const sign = atom.dFi >= 0 ? 1 : -1;
  wave(
    (t) =>
      sign *
      env *
      Math.cos(t) *
      (atom.allowed ? 1 : 0),
    '#fb7185',
    1.9,
    false,
  );

  label(ctx, 'E/E₀', pad.l + 2, pad.t + 10, 'rgba(251,191,36,0.95)', 10);
  label(ctx, '⟨d⟩/d_fi', pad.l + 40, pad.t + 10, 'rgba(251,113,133,0.95)', 10);
  label(ctx, `${cycles} optical cycles →`, w - pad.r - 84, h - 3, 'rgba(148,163,184,0.65)', 9);
  if (!atom.allowed) {
    label(ctx, 'no dipole: d_fi = 0', pad.l + 96, pad.t + 10, 'rgba(148,163,184,0.9)', 10);
  }
}

/* ------------------------------- spectrum bar ----------------------------- */

export function drawTransitionLine(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  atom: AtomNumbers,
): void {
  const nm = atom.wavelengthNm;
  const [r, g, b] = wavelengthToRGB(nm);
  const col = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  ctx.save();
  ctx.fillStyle = 'rgba(148,163,184,0.18)';
  ctx.fillRect(0, h - 6, w, 6);
  const x = Math.max(2, Math.min(w - 2, ((nm - 40) / 1260) * w));
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.4;
  ctx.shadowColor = col;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(x, 4);
  ctx.lineTo(x, h - 6);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(232,238,252,0.85)';
  ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(`${nm.toFixed(1)} nm`, Math.min(w - 54, x + 6), 14);
  ctx.fillStyle = 'rgba(148,163,184,0.7)';
  ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText('40', 2, h - 10);
  ctx.fillText('1300 nm', w - 44, h - 10);
  ctx.restore();
}
