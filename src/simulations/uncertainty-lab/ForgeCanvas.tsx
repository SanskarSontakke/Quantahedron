'use client';

/**
 * Uncertainty Forge — the dual canvas viewport.
 *
 * Two stacked imperative canvases locked by a radix-2 FFT: ψ(x) on top, its
 * continuous-normalised momentum amplitude φ(p) below, plus a Heisenberg gauge
 * driven by the *exact* second moments of whatever is currently on screen. Drag
 * on the upper panel to freehand-paint Re ψ when the envelope is `custom`; drag
 * it sideways to translate the packet (shift-drag to squeeze).
 *
 * No React state is involved in the 60 Hz path. Solver-derived numbers are
 * mirrored back into the store at 4 Hz so the telemetry pills and permalinks
 * stay truthful without re-rendering the shell every frame.
 */

import { useEffect, useRef } from 'react';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { useSimStore, pBool, pStr } from '@/store/useSimStore';
import { phaseColor, rgbCss } from '@/lib/colorMap';
import type { SimParams, SimSlug } from '@/simulations/types';
import {
  HEISENBERG_FLOOR,
  type EnvelopeKind,
  type ForgeGrid,
  type ForgeParams,
  type Moments,
  analyticGaussian,
  buildWavefunction,
  gaugeState,
  makeGrid,
  momentumMoments,
  numParam,
  paintDrawn,
  positionMoments,
  resampleDrawn,
  stepFree,
  toMomentum,
  xAt,
} from './wavepacket';

/** Freehand buffer ceiling — also the permalink-friendly array length. */
const MAX_DRAWN = 512;
const MIRROR_MS = 250;
const PAINT_MS = 120;
const EMPTY: number[] = [];

const CYAN = '34,211,238';
const VIOLET = '167,139,250';
const INK = 'rgba(159,176,204,0.9)';
const FAINT = 'rgba(107,125,153,0.92)';
const MONO = '600 10px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Pads shared by the drawing code and the pointer→physics mapping. */
const PAD = { l: 12, r: 12, t: 24, b: 20 };
const GAUGE_H = 34;
const GAUGE_MAX = 1.5;

interface Forge {
  g: ForgeGrid;
  psi: Float64Array;
  spec: Float64Array;
  work: Float64Array;
  dens: Float64Array;
  specD: Float64Array;
  m: Moments;
  drawn: number[];
  /** The store array this buffer was derived from — identity, not contents. */
  lastIncoming: number[];
  /** Last seen value of the `drawClear` token. */
  clear: number;
  drawnRev: number;
  sigma0: number;
  sig: string;
  t: number;
  mirrorAt: number;
  paintAt: number;
  painting: boolean;
  dragX: number;
  dragFrom: number;
  dragCenter0: number;
  gauss: boolean;
}

const zeroMoments = (): Moments => ({
  norm: 0,
  meanX: 0,
  varX: 0,
  sigmaX: 0,
  meanP: 0,
  varP: 0,
  sigmaP: 0,
  product: 0,
  kinetic: 0,
});

/* ------------------------------ canvas plumbing ---------------------------- */

function fit(cv: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr));
  const h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, w / dpr, h / dpr];
}

function tag(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = MONO;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

function chrome(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, right: string, tone: string): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(6,8,13,0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(148,163,184,0.20)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  tag(ctx, title, 10, 7, INK);
  tag(ctx, right, w - 10, 7, tone, 'right');
}

/** Poly-line through every sample of a length-N curve. */
function trace(
  ctx: CanvasRenderingContext2D,
  n: number,
  px: (i: number) => number,
  py: (i: number) => number,
): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = px(i);
    const y = py(i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/* ------------------------------- the gauge --------------------------------- */

function drawGauge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  product: number,
  norm: number,
): void {
  const live = norm > 1e-9 && Number.isFinite(product) && product > 0;
  const pos = (v: number): number =>
    x + Math.max(0, Math.min(1, (v - HEISENBERG_FLOOR) / (GAUGE_MAX - HEISENBERG_FLOOR))) * w;
  const state = gaugeState(product);
  const rgb = !live ? '148,163,184' : state === 'good' ? '52,211,153' : state === 'warn' ? '251,191,36' : '251,113,133';

  ctx.fillStyle = 'rgba(148,163,184,0.16)';
  ctx.fillRect(x, y + 6, w, 7);
  // The green band is the tolerance: only within 0.5 % of ħ/2 lights up.
  ctx.fillStyle = 'rgba(52,211,153,0.8)';
  ctx.fillRect(x, y + 6, Math.min(w, pos(HEISENBERG_FLOOR * 1.005) - x), 7);
  ctx.strokeStyle = 'rgba(6,8,13,0.9)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const t = x + (i / 4) * w;
    ctx.beginPath();
    ctx.moveTo(t, y + 6);
    ctx.lineTo(t, y + 13);
    ctx.stroke();
  }
  if (live) {
    const nx = pos(product);
    ctx.fillStyle = `rgba(${rgb},1)`;
    ctx.beginPath();
    ctx.moveTo(nx, y + 3);
    ctx.lineTo(nx + 4, y + 1);
    ctx.lineTo(nx, y + 17);
    ctx.lineTo(nx - 4, y + 1);
    ctx.closePath();
    ctx.fill();
  }

  tag(ctx, 'ħ/2', x, y + 19, FAINT);
  tag(ctx, 'σx·σp ≥ ħ/2', x + w * 0.5, y + 19, FAINT, 'center');
  tag(
    ctx,
    live
      ? `${product.toFixed(4)}  ×${(product / HEISENBERG_FLOOR).toFixed(3)} the floor`
      : 'no state — paint a packet',
    x + w,
    y + 19,
    `rgba(${rgb},0.95)`,
    'right',
  );
}

/* ------------------------------- the panels -------------------------------- */

interface Look {
  palette: 'twilight' | 'cividis';
  phaseColor: boolean;
  showPhase: boolean;
  showGauge: boolean;
  logMagnitude: boolean;
  envelope: EnvelopeKind;
  analyticSigmaP: number;
}

function drawPosition(ctx: CanvasRenderingContext2D, w: number, h: number, rt: Forge, look: Look): void {
  const g = rt.g;
  const m = rt.m;
  const bottom = look.showGauge ? PAD.b + GAUGE_H : PAD.b;
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - bottom;
  chrome(
    ctx,
    w,
    h,
    'ψ(x) · POSITION',
    `σx = ${m.sigmaX.toFixed(3)}   ⟨x⟩ = ${m.meanX.toFixed(2)}`,
    `rgba(${CYAN},0.92)`,
  );
  if (iw < 40 || ih < 30) return;

  const mid = PAD.t + ih * 0.55;
  const amp = ih * 0.44;
  const px = (x: number): number => PAD.l + ((x + g.xMax) / (2 * g.xMax)) * iw;
  const cell = iw / g.N;

  // ±σx band: the position half of the product, drawn as a rectangle.
  ctx.fillStyle = `rgba(${CYAN},0.07)`;
  ctx.fillRect(px(m.meanX - m.sigmaX), PAD.t, Math.max(1, px(2 * m.sigmaX) - px(0)), ih);

  let peak = 1e-12;
  for (let j = 0; j < g.N; j++) if (rt.dens[j] > peak) peak = rt.dens[j];
  const inv = 1 / Math.sqrt(peak);

  if (look.phaseColor && m.norm > 1e-9) {
    // Hue = arg ψ, extent = |ψ| — brightness never lies about probability.
    for (let j = 0; j < g.N; j++) {
      const a = Math.sqrt(rt.dens[j]) * inv;
      if (a < 0.02) continue;
      const ang = Math.atan2(rt.psi[j * 2 + 1], rt.psi[j * 2]);
      ctx.fillStyle = rgbCss(phaseColor(ang, look.palette), 0.28 + 0.52 * a);
      const hh = a * amp;
      ctx.fillRect(px(xAt(g, j)) - cell * 0.5, mid - hh, cell * 1.05, hh * 2);
    }
  } else {
    ctx.beginPath();
    for (let j = 0; j < g.N; j++) ctx.lineTo(px(xAt(g, j)), mid - Math.sqrt(rt.dens[j]) * inv * amp);
    for (let j = g.N - 1; j >= 0; j--) ctx.lineTo(px(xAt(g, j)), mid + Math.sqrt(rt.dens[j]) * inv * amp);
    ctx.closePath();
    ctx.fillStyle = `rgba(${CYAN},0.18)`;
    ctx.fill();
  }

  ctx.strokeStyle = `rgba(${CYAN},0.95)`;
  ctx.lineWidth = 1.4;
  trace(ctx, g.N, (j) => px(xAt(g, j)), (j) => mid - Math.sqrt(rt.dens[j]) * inv * amp);
  ctx.stroke();

  if (look.showPhase) {
    const cols = ['rgba(226,232,240,0.7)', `rgba(${VIOLET},0.8)`];
    for (let c = 0; c < 2; c++) {
      ctx.strokeStyle = cols[c];
      ctx.lineWidth = 1;
      trace(
        ctx,
        g.N,
        (j) => px(xAt(g, j)),
        (j) => mid - (c === 0 ? rt.psi[j * 2] : rt.psi[j * 2 + 1]) * inv * amp,
      );
      ctx.stroke();
    }
  }

  // The raw freehand stroke, so the learner sees what they actually painted.
  if (look.envelope === 'custom' && rt.drawn.length > 1) {
    const n = rt.drawn.length;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(251,191,36,0.75)';
    ctx.lineWidth = 1;
    trace(ctx, n, (i) => px(-g.xMax + (i / (n - 1)) * 2 * g.xMax), (i) => mid - rt.drawn[i] * amp * 0.92);
    ctx.stroke();
    ctx.setLineDash([]);
    tag(ctx, 'painted Re ψ', PAD.l + 2, PAD.t + 2, 'rgba(251,191,36,0.85)');
  }

  ctx.strokeStyle = 'rgba(148,163,184,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.l, mid);
  ctx.lineTo(w - PAD.r, mid);
  ctx.stroke();
  const stepT = g.xMax > 8 ? 4 : g.xMax > 4 ? 2 : 1;
  for (let xv = -Math.floor(g.xMax / stepT) * stepT; xv <= g.xMax; xv += stepT) {
    const x = px(xv);
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.beginPath();
    ctx.moveTo(x, PAD.t + ih);
    ctx.lineTo(x, PAD.t + ih + 4);
    ctx.stroke();
    tag(ctx, String(xv), x, PAD.t + ih + 6, FAINT, 'center');
  }
  tag(ctx, 'x (a₀)', w - PAD.r, PAD.t + ih + 6, FAINT, 'right');

  if (m.norm > 1e-9) {
    ctx.strokeStyle = `rgba(${CYAN},0.75)`;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(px(m.meanX), PAD.t);
    ctx.lineTo(px(m.meanX), PAD.t + ih);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (look.showGauge) drawGauge(ctx, PAD.l + 4, h - GAUGE_H, iw - 8, m.product, m.norm);
}

function drawMomentum(ctx: CanvasRenderingContext2D, w: number, h: number, rt: Forge, look: Look): void {
  const g = rt.g;
  const m = rt.m;
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  chrome(
    ctx,
    w,
    h,
    'φ(p) = FFT[ψ] · MOMENTUM',
    `σp = ${m.sigmaP.toFixed(3)}   ⟨p⟩ = ${m.meanP.toFixed(2)}`,
    `rgba(${VIOLET},0.92)`,
  );
  if (iw < 40 || ih < 30) return;

  const base = PAD.t + ih;
  const px = (k: number): number => PAD.l + ((k + g.kMax) / (2 * g.kMax)) * iw;

  let peak = 1e-12;
  for (let i = 0; i < g.N; i++) {
    const re = rt.spec[i * 2];
    const im = rt.spec[i * 2 + 1];
    const d = re * re + im * im;
    rt.specD[i] = d;
    if (d > peak) peak = d;
  }
  const yOf = (d: number): number => {
    const v = d / peak;
    const s = look.logMagnitude ? Math.log1p(v * 999) / Math.log(1000) : v;
    return base - s * ih * 0.88;
  };

  // ±σp band, drawn with the same rectangle idiom as the panel above.
  ctx.fillStyle = `rgba(${VIOLET},0.08)`;
  ctx.fillRect(px(m.meanP - m.sigmaP), PAD.t, Math.max(1, px(2 * m.sigmaP) - px(0)), ih);

  if (m.norm > 1e-9) {
    ctx.beginPath();
    for (let i = 0; i < g.N; i++) ctx.lineTo(px((i - g.N / 2) * g.dk), yOf(rt.specD[i]));
    ctx.lineTo(w - PAD.r, base);
    ctx.lineTo(PAD.l, base);
    ctx.closePath();
    ctx.fillStyle = `rgba(${VIOLET},0.2)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${VIOLET},0.95)`;
    ctx.lineWidth = 1.4;
    trace(ctx, g.N, (i) => px((i - g.N / 2) * g.dk), (i) => yOf(rt.specD[i]));
    ctx.stroke();
  }

  // Closed-form |φ(p)|² of the chirped Gaussian, overlaid on the numeric transform.
  if (rt.gauss && m.norm > 1e-9) {
    const sp = Math.max(1e-6, look.analyticSigmaP);
    const q = 1 / (2 * sp * sp);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(251,191,36,0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= 220; i++) {
      const k = -g.kMax + (i / 220) * 2 * g.kMax;
      const dv = Math.exp(-q * (k - m.meanP) * (k - m.meanP));
      ctx.lineTo(px(k), look.logMagnitude ? yOf(dv * peak) : base - dv * ih * 0.88);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    tag(ctx, 'analytic |φ|²', PAD.l + 2, PAD.t + 2, 'rgba(251,191,36,0.85)');
  }

  ctx.strokeStyle = 'rgba(148,163,184,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.l, base);
  ctx.lineTo(w - PAD.r, base);
  ctx.stroke();
  const kt = Math.max(1, Math.round(g.kMax / 4));
  for (let kv = -Math.floor(g.kMax / kt) * kt; kv <= g.kMax; kv += kt) {
    const x = px(kv);
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, base + 4);
    ctx.stroke();
    tag(ctx, String(kv), x, base + 6, FAINT, 'center');
  }
  tag(ctx, `p (ħ/a₀) · Δp = ${g.dk.toFixed(3)}`, w - PAD.r, base + 6, FAINT, 'right');

  if (m.norm > 1e-9) {
    ctx.strokeStyle = `rgba(${VIOLET},0.7)`;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(px(m.meanP), PAD.t);
    ctx.lineTo(px(m.meanP), base);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/* -------------------------------- component -------------------------------- */

export default function ForgeCanvas({ slug }: { slug: SimSlug }) {
  const posRef = useRef<HTMLCanvasElement | null>(null);
  const momRef = useRef<HTMLCanvasElement | null>(null);
  const rtRef = useRef<Forge | null>(null);

  useEffect(() => {
    const pos = posRef.current;
    if (!pos) return;
    const p = useSimStore.getState().params[slug] ?? {};
    const g = makeGrid(numParam(p, 'gridN', 512), numParam(p, 'xMax', 12));
    const stored = Array.isArray(p.drawnWave) ? p.drawnWave : EMPTY;
    const drawnLen = Math.min(MAX_DRAWN, g.N);
    const rt: Forge = {
      g,
      psi: new Float64Array(g.N * 2),
      spec: new Float64Array(g.N * 2),
      work: new Float64Array(g.N * 2),
      dens: new Float64Array(g.N),
      specD: new Float64Array(g.N),
      m: zeroMoments(),
      drawn: stored.length ? resampleDrawn(stored, drawnLen) : new Array<number>(drawnLen).fill(0),
      lastIncoming: stored,
      clear: numParam(p, 'drawClear', 0),
      drawnRev: 0,
      sigma0: 0,
      sig: '',
      t: 0,
      mirrorAt: 0,
      paintAt: 0,
      painting: false,
      dragX: 0,
      dragFrom: 0,
      dragCenter0: 0,
      gauss: pStr(p, 'envelope', 'gauss') === 'gauss',
    };
    rtRef.current = rt;

    /* ---------------------------- pointer plumbing --------------------------- */
    const geom = (): { mid: number; amp: number } => {
      const r = pos.getBoundingClientRect();
      const ih = r.height - PAD.t - (PAD.b + GAUGE_H);
      return { mid: PAD.t + ih * 0.55, amp: Math.max(1, ih * 0.44) };
    };
    const toX = (clientX: number): number => {
      const r = pos.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
      return -rt.g.xMax + t * 2 * rt.g.xMax;
    };
    const toValue = (clientY: number): number => {
      const r = pos.getBoundingClientRect();
      const { mid, amp } = geom();
      return Math.max(-1, Math.min(1, (mid - (clientY - r.top)) / amp));
    };
    const commit = (force: boolean): void => {
      const now = performance.now();
      if (!force && now - rt.paintAt < PAINT_MS) return;
      rt.paintAt = now;
      const next = rt.drawn.slice();
      rt.lastIncoming = next;
      useSimStore.getState().setParam(slug, 'drawnWave', next);
    };

    const onMove = (ev: PointerEvent): void => {
      if (!rt.painting) return;
      const store = useSimStore.getState();
      const st: SimParams = store.params[slug] ?? {};
      const g2 = rt.g;
      const x = toX(ev.clientX);
      if (pStr(st, 'envelope', 'gauss') === 'custom') {
        const len = Math.min(MAX_DRAWN, g2.N);
        const brush = (Math.max(1, numParam(st, 'brushSize', 12)) / 100) * 2 * g2.xMax;
        rt.drawn = paintDrawn(
          rt.drawn.length === len ? rt.drawn : new Array<number>(len).fill(0),
          len,
          g2,
          rt.dragX,
          x,
          toValue(ev.clientY),
          brush,
        );
        rt.drawnRev += 1;
        commit(false);
      } else if (ev.shiftKey) {
        // Shift-drag squeezes: the horizontal offset rescales σ geometrically.
        const w0 = numParam(st, 'width', 0.6);
        const k = w0 * Math.exp((x - rt.dragFrom) / Math.max(2, g2.xMax));
        store.setParam(slug, 'width', Math.round(Math.max(0.04, Math.min(g2.xMax * 0.9, k)) * 1000) / 1000);
      } else {
        const dx = x - rt.dragFrom;
        const c = rt.dragCenter0 + dx;
        store.setParam(slug, 'center', Math.round(Math.max(-g2.xMax + 1, Math.min(g2.xMax - 1, c)) * 1000) / 1000);
      }
      rt.dragX = x;
    };
    const onDown = (ev: PointerEvent): void => {
      rt.painting = true;
      rt.dragFrom = toX(ev.clientX);
      rt.dragX = rt.dragFrom;
      rt.dragCenter0 = numParam(useSimStore.getState().params[slug] ?? {}, 'center', 0);
      pos.setPointerCapture(ev.pointerId);
      onMove(ev);
    };
    const onUp = (ev: PointerEvent): void => {
      if (!rt.painting) return;
      rt.painting = false;
      if (pos.hasPointerCapture(ev.pointerId)) pos.releasePointerCapture(ev.pointerId);
      commit(true);
    };
    const onWheel = (ev: WheelEvent): void => {
      ev.preventDefault();
      const st: SimParams = useSimStore.getState().params[slug] ?? {};
      const next = numParam(st, 'width', 0.6) * Math.exp(ev.deltaY * 0.0012);
      useSimStore.getState().setParam(
        slug,
        'width',
        Math.round(Math.max(0.04, Math.min(rt.g.xMax * 0.9, next)) * 1000) / 1000,
      );
    };

    pos.addEventListener('pointerdown', onDown);
    pos.addEventListener('pointermove', onMove);
    pos.addEventListener('pointerup', onUp);
    pos.addEventListener('pointercancel', onUp);
    pos.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      pos.removeEventListener('pointerdown', onDown);
      pos.removeEventListener('pointermove', onMove);
      pos.removeEventListener('pointerup', onUp);
      pos.removeEventListener('pointercancel', onUp);
      pos.removeEventListener('wheel', onWheel);
      rtRef.current = null;
    };
  }, [slug]);

  useAnimationClock(({ dt }) => {
    const rt = rtRef.current;
    const pos = posRef.current;
    const mom = momRef.current;
    if (!rt || !pos || !mom) return;
    const store = useSimStore.getState();
    const p: SimParams = store.params[slug] ?? {};

    /* grid change → reallocate every buffer */
    const gridN = numParam(p, 'gridN', 512);
    const xMax = numParam(p, 'xMax', 12);
    if (gridN !== rt.g.N || xMax !== rt.g.xMax) {
      const g = makeGrid(gridN, xMax);
      rt.g = g;
      rt.psi = new Float64Array(g.N * 2);
      rt.spec = new Float64Array(g.N * 2);
      rt.work = new Float64Array(g.N * 2);
      rt.dens = new Float64Array(g.N);
      rt.specD = new Float64Array(g.N);
      rt.drawn = rt.drawn.length ? resampleDrawn(rt.drawn, Math.min(MAX_DRAWN, g.N)) : rt.drawn;
      rt.sig = '';
    }
    const g = rt.g;
    const len = Math.min(MAX_DRAWN, g.N);

    // The tab's Clear button bumps a token rather than only emptying the array,
    // so a stale buffer in another mount of this canvas cannot resurrect a stroke.
    const drawClear = numParam(p, 'drawClear', 0);
    if (drawClear !== rt.clear) {
      rt.clear = drawClear;
      const next = new Array<number>(len).fill(0);
      rt.drawn = next;
      rt.lastIncoming = next;
      rt.drawnRev += 1;
      store.setParam(slug, 'drawnWave', next);
    }

    // Adopt drawings that came from elsewhere (permalink, reset, tab buttons).
    const incoming = Array.isArray(p.drawnWave) ? p.drawnWave : EMPTY;
    if (incoming !== rt.lastIncoming) {
      rt.lastIncoming = incoming;
      rt.drawn = incoming.length ? resampleDrawn(incoming, len) : new Array<number>(len).fill(0);
      rt.drawnRev += 1;
    }
    if (rt.drawn.length !== len) {
      rt.drawn = rt.drawn.length ? resampleDrawn(rt.drawn, len) : new Array<number>(len).fill(0);
      rt.drawnRev += 1;
    }

    const env = pStr(p, 'envelope', 'gauss') as EnvelopeKind;
    const width = Math.max(0.04, numParam(p, 'width', 0.6));
    const chirp = numParam(p, 'chirp', 0);
    const tilt = numParam(p, 'tilt', 0);
    const center = numParam(p, 'center', 0);
    const fp: ForgeParams = { envelope: env, width, chirp, tilt, center, drawn: rt.drawn };

    const sig = `${env}|${width}|${chirp}|${tilt}|${center}|${g.N}|${g.xMax}|${rt.drawnRev}`;
    if (sig !== rt.sig) {
      rt.sig = sig;
      rt.gauss = env === 'gauss';
      buildWavefunction(fp, g, rt.psi);
      rt.t = 0;
      rt.sigma0 = positionMoments(rt.psi, g).sigmaX;
      store.setParam(slug, 'evolveTime', 0);
    }

    /* ------------------------- free propagation (exact) ---------------------- */
    if (pBool(p, 'evolve', true) && dt > 0) {
      const simDt = Math.max(0, numParam(p, 'dt', 0.0008));
      const steps = Math.max(1, Math.min(24, Math.round(numParam(p, 'substeps', 3) * dt * 60)));
      for (let i = 0; i < steps; i++) stepFree(rt.psi, g, simDt);
      rt.t += steps * simDt;
    }

    /* -------------------------------- measure -------------------------------- */
    toMomentum(rt.psi, g, rt.spec);
    const xm = positionMoments(rt.psi, g);
    const pm = momentumMoments(rt.psi, g, rt.work);
    rt.m = {
      norm: xm.norm,
      meanX: xm.meanX,
      varX: xm.varX,
      sigmaX: xm.sigmaX,
      meanP: pm.meanP,
      varP: pm.varP,
      sigmaP: pm.sigmaP,
      product: xm.sigmaX * pm.sigmaP,
      kinetic: 0.5 * (pm.varP + pm.meanP * pm.meanP),
    };
    for (let j = 0; j < g.N; j++) {
      const re = rt.psi[j * 2];
      const im = rt.psi[j * 2 + 1];
      rt.dens[j] = re * re + im * im;
    }

    /* -------------------------------- render --------------------------------- */
    const look: Look = {
      palette: store.prefs.palette,
      phaseColor: pBool(p, 'phaseColor', true),
      showPhase: pBool(p, 'showPhase', true),
      showGauge: pBool(p, 'showGauge', true),
      logMagnitude: pBool(p, 'logMagnitude', false),
      envelope: env,
      analyticSigmaP: analyticGaussian(fp).sigmaP,
    };
    const mode = pStr(p, 'view', 'both');
    pos.style.display = mode === 'momentum' ? 'none' : 'block';
    mom.style.display = mode === 'position' ? 'none' : 'block';
    if (mode !== 'momentum') {
      const pc = fit(pos);
      if (pc) drawPosition(pc[0], pc[1], pc[2], rt, look);
    }
    if (mode !== 'position') {
      const mc = fit(mom);
      if (mc) drawMomentum(mc[0], mc[1], mc[2], rt, look);
    }

    /* ------------------------------ mirror back ------------------------------ */
    const now = performance.now();
    if (now - rt.mirrorAt > MIRROR_MS) {
      rt.mirrorAt = now;
      const m = rt.m;
      store.setParams(slug, {
        sigmaX: rnd(m.sigmaX, 5),
        sigmaP: rnd(m.sigmaP, 5),
        product: rnd(m.product, 5),
        meanX: rnd(m.meanX, 4),
        meanP: rnd(m.meanP, 4),
        energy: rnd(m.kinetic, 5),
        waveNorm: rnd(m.norm, 6),
        analyticProduct: rnd(analyticGaussian(fp).product, 5),
        sigma0: rnd(rt.sigma0, 5),
        evolveTime: rnd(rt.t, 4),
      });
    }
  });

  return (
    <div className="absolute inset-0 flex flex-col gap-1 p-1">
      <canvas
        ref={posRef}
        className="min-h-0 w-full flex-1 cursor-crosshair touch-none rounded-md"
        aria-label="Position-space wavefunction with the Heisenberg gauge"
      />
      <div className="shrink-0 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">
        ħ = mₑ = a₀ = 1 · drag to paint or translate · wheel squeezes σx
      </div>
      <canvas
        ref={momRef}
        className="min-h-0 w-full flex-1 rounded-md"
        aria-label="Momentum-space amplitude from the radix-2 FFT"
      />
    </div>
  );
}

const rnd = (v: number, d: number): number => {
  const f = Math.pow(10, d);
  return Number.isFinite(v) ? Math.round(v * f) / f : 0;
};
