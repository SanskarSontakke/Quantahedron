'use client';

/**
 * 2D Double-Slit — stage viewport.
 *
 * One imperative canvas pair: the *field* canvas is owned by whichever engine
 * won the capability race (WebGL2 float ping-pong, else the CPU Float32Array
 * integrator), and a 2D overlay canvas draws the phosphor screen — individual
 * clicks, the accumulated histogram, the live |ψ|² profile and the theory curve
 * from `d·sinθ = mλ`.
 *
 * Nothing here goes through React state: the 60 Hz loop reads the store directly
 * and mirrors solver-derived numbers back into params (throttled to 4 Hz) so the
 * telemetry pills and permalinks stay honest without re-rendering every frame.
 */

import { useEffect, useRef } from 'react';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { useSimStore, pBool, pNum, pStr } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import { createCpuEngine } from './cpu';
import { createGpuEngine, gpuCapable } from './gpu';
import {
  MAX_BINS,
  MAX_DOTS,
  type SlitConfig,
  type SlitEngine,
  binStrip,
  buildConfig,
  cpuGridRes,
  fringeVisibility,
  histFromArray,
  histToArray,
  measureFringeSpacing,
  pickBin,
  poissonCount,
  requestGridRes,
} from './solver';

const CANVAS_CLASS = 'absolute inset-0 block h-full w-full';
/** Phosphor persistence in seconds: a click flares, then fades to latent image. */
const DOT_LIFE = 5.0;
const MIRROR_MS = 250;
const HIST_MS = 1500;

interface Runtime {
  engine: SlitEngine | null;
  el: HTMLCanvasElement | null;
  hist: Float64Array;
  bins: number;
  rows: number;
  density: Float32Array;
  flux: Float32Array;
  profile: Float64Array;
  weights: Float64Array;
  dotBin: Int32Array;
  dotJit: Float32Array;
  dotT: Float32Array;
  dotHead: number;
  dotLive: number;
  emitAcc: number;
  expected: number;
  clicks: number;
  packets: number;
  lastClear: number;
  lastReset: number;
  lastScript: string;
  lastDemoT: number;
  lastTag: number;
  mirrorAt: number;
  histAt: number;
  clock: number;
  vis: number;
  fringe: number;
  norm: number;
  ready: boolean;
}

function makeRuntime(bins: number): Runtime {
  return {
    engine: null,
    el: null,
    hist: new Float64Array(bins),
    bins,
    rows: bins,
    density: new Float32Array(bins),
    flux: new Float32Array(bins),
    profile: new Float64Array(bins),
    weights: new Float64Array(bins),
    dotBin: new Int32Array(MAX_DOTS),
    dotJit: new Float32Array(MAX_DOTS),
    dotT: new Float32Array(MAX_DOTS),
    dotHead: 0,
    dotLive: 0,
    emitAcc: 0,
    expected: 0,
    clicks: 0,
    packets: 0,
    lastClear: 0,
    lastReset: 0,
    lastScript: '',
    lastDemoT: 0,
    lastTag: Number.NaN,
    mirrorAt: 0,
    histAt: 0,
    clock: 0,
    vis: 0,
    fringe: 0,
    norm: 0,
    ready: false,
  };
}

/* ------------------------------ canvas plumbing ---------------------------- */

function overlayCtx(canvas: HTMLCanvasElement, host: HTMLElement): [CanvasRenderingContext2D, number, number] | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(host.clientWidth * dpr));
  const h = Math.max(1, Math.round(host.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, w / dpr, h / dpr];
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number): void {
  ctx.fillStyle = `rgba(6, 8, 13, ${alpha})`;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left'): void {
  ctx.font = '600 10px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

/**
 * Far-field pattern for the *current* geometry: single-slit sinc² envelope times
 * the two-slit fringe term, with sinθ taken exactly from the detector coordinate
 * and the fringe depth set by the measured visibility. Nothing is fitted.
 */
export function theoryAt(cfg: SlitConfig, u: number, visibility: number): number {
  const dy = u - 0.5;
  const L = Math.max(0.05, cfg.screenX - cfg.barrierX);
  const sin = dy / Math.hypot(L, dy);
  const b = (Math.PI * cfg.slitW * sin) / cfg.lambda;
  const env = Math.abs(b) < 1e-6 ? 1 : Math.pow(Math.sin(b) / b, 2);
  const d = (Math.PI * cfg.sep * sin) / cfg.lambda;
  return env * (1 + visibility * Math.cos(2 * d)) * 0.5;
}

/* --------------------------------- drawing --------------------------------- */

function drawPhosphor(
  ctx: CanvasRenderingContext2D,
  rt: Runtime,
  cfg: SlitConfig,
  x: number,
  y: number,
  w: number,
  h: number,
  full: boolean,
): void {
  const bins = rt.bins;
  panel(ctx, x, y, w, h, full ? 0.72 : 0.85);
  const pad = full ? 16 : 9;
  const head = y + pad;
  tag(ctx, full ? 'PHOSPHOR SCREEN' : 'SCREEN', x + pad, head, 'rgba(159, 176, 204, 0.9)');
  tag(ctx, `${rt.clicks} hits · V=${rt.vis.toFixed(2)}`, x + w - pad, head, 'rgba(94, 234, 212, 0.92)', 'right');

  const baseY = head + 15;
  const bodyH = Math.max(20, h - (baseY - y) - pad - (full ? 16 : 0));
  const colW = full ? Math.min(120, w * 0.32) : Math.min(58, w * 0.24);
  const colX = x + pad;
  const histX = colX + colW + (full ? 14 : 6);
  const histW = Math.max(10, x + w - pad - histX);
  const yOf = (u: number): number => baseY + (1 - u) * bodyH;

  // Individual arrivals: the dots are the raw data, the curve is the pattern.
  ctx.save();
  ctx.beginPath();
  ctx.rect(colX, baseY, colW, bodyH);
  ctx.clip();
  ctx.fillStyle = 'rgba(129, 140, 248, 0.06)';
  ctx.fillRect(colX, baseY, colW, bodyH);
  for (let i = 0; i < rt.dotLive; i++) {
    const age = rt.clock - (rt.dotT[i] ?? 0);
    if (age < 0 || age > DOT_LIFE) continue;
    const fade = 1 - age / DOT_LIFE;
    const b = rt.dotBin[i] ?? 0;
    const yy = baseY + ((bins - 1 - b - 0.5) / bins) * bodyH;
    const xx = colX + colW * 0.5 + (rt.dotJit[i] ?? 0) * colW * 0.44;
    ctx.fillStyle = `rgba(${Math.round(150 + 90 * fade)}, 250, ${Math.round(205 + 40 * fade)}, ${(0.22 + 0.62 * fade).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(xx, yy, 1.4 + 1.5 * fade, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.strokeRect(colX + 0.5, baseY + 0.5, colW, bodyH);

  let peak = 0;
  for (let b = 0; b < bins; b++) if ((rt.hist[b] ?? 0) > peak) peak = rt.hist[b] ?? 0;
  let dPeak = 0;
  for (let r = 0; r < rt.rows; r++) if ((rt.density[r] ?? 0) > dPeak) dPeak = rt.density[r] ?? 0;
  const scale = peak > 0 ? peak : 1;

  // Accumulated histogram.
  ctx.beginPath();
  for (let b = 0; b < bins; b++) {
    const v = Math.min(1, (rt.hist[b] ?? 0) / scale);
    if (b === 0) ctx.moveTo(histX + v * histW, yOf(0.5 / bins));
    else ctx.lineTo(histX + v * histW, yOf((b + 0.5) / bins));
  }
  ctx.lineTo(histX + Math.min(1, (rt.hist[bins - 1] ?? 0) / scale) * histW, yOf((bins - 0.5) / bins));
  for (let b = bins - 1; b >= 0; b--) ctx.lineTo(histX, yOf((b + 0.5) / bins));
  ctx.closePath();
  ctx.fillStyle = 'rgba(94, 234, 212, 0.18)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(94, 234, 212, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let b = 0; b < bins; b++) {
    const v = Math.min(1, (rt.hist[b] ?? 0) / scale) * histW;
    if (b === 0) ctx.moveTo(histX + v, yOf(0.5 / bins));
    else ctx.lineTo(histX + v, yOf((b + 0.5) / bins));
  }
  ctx.stroke();

  // Instantaneous |ψ|² on the detector line.
  if (dPeak > 0) {
    ctx.strokeStyle = 'rgba(129, 140, 248, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r < rt.rows; r++) {
      const v = ((rt.density[r] ?? 0) / dPeak) * histW;
      if (r === 0) ctx.moveTo(histX + v, yOf(0.5 / rt.rows));
      else ctx.lineTo(histX + v, yOf((r + 0.5) / rt.rows));
    }
    ctx.stroke();
  }

  // Theory: the same geometry, predicted rather than fitted.
  let tMax = 1e-9;
  for (let s = 0; s <= 96; s++) tMax = Math.max(tMax, theoryAt(cfg, s / 96, 1));
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let s = 0; s <= 96; s++) {
    const u = 1 - s / 96;
    const v = (theoryAt(cfg, u, rt.vis) / tMax) * histW;
    if (s === 0) ctx.moveTo(histX + v, yOf(u));
    else ctx.lineTo(histX + v, yOf(u));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
  ctx.beginPath();
  ctx.moveTo(histX, baseY);
  ctx.lineTo(histX, baseY + bodyH);
  ctx.stroke();
  if (full) {
    tag(ctx, 'y along screen', x + pad, baseY + bodyH + 4, 'rgba(107, 125, 153, 0.9)');
    tag(ctx, 'accumulated · live |ψ|² · d·sinθ = mλ', x + w - pad, baseY + bodyH + 4, 'rgba(107, 125, 153, 0.9)', 'right');
  }
}

function drawHud(ctx: CanvasRenderingContext2D, rt: Runtime, cfg: SlitConfig, h: number, kind: string): void {
  const pred = cfg.lambda * ((cfg.screenX - cfg.barrierX) / cfg.sep);
  const lines = [
    `λ=2π/p ${cfg.lambda.toFixed(4)}  d/λ ${(cfg.sep / cfg.lambda).toFixed(1)}`,
    `Δy pred ${pred.toFixed(4)}  meas ${rt.fringe > 0 ? rt.fringe.toFixed(4) : '—'}`,
    `${kind}  N=${rt.engine?.N ?? cfg.N}  e⁻ ${rt.packets}  ‖ψ‖ ${rt.norm.toFixed(3)}`,
  ];
  const bw = 196;
  const bh = 42;
  const x = 8;
  const y = h - bh - 8;
  panel(ctx, x, y, bw, bh, 0.55);
  let yy = y + 5;
  for (const line of lines) {
    tag(ctx, line, x + 6, yy, 'rgba(159, 176, 204, 0.85)');
    yy += 12;
  }
}

/* -------------------------------- component -------------------------------- */

export default function FieldCanvas({ slug }: { slug: SimSlug }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const rtRef = useRef<Runtime | null>(null);
  const gridKey = useSimStore((s) => `${s.params[slug]?.gridRes ?? 0}`);
  const renderMode = useSimStore((s) => pStr(s.params[slug] ?? {}, 'render', ''));
  const viewModel = useSimStore((s) => pStr(s.params[slug] ?? {}, 'view', 'field'));

  // The stage's keyboard cycles a `render` param; mirror it onto `view`.
  useEffect(() => {
    if (renderMode && renderMode !== viewModel) useSimStore.getState().setParam(slug, 'view', renderMode);
  }, [slug, renderMode, viewModel]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const p = useSimStore.getState().params[slug] ?? {};
    const bins = Math.max(32, Math.min(MAX_BINS, Math.round(pNum(p, 'screenBins', 220))));
    const rt = makeRuntime(bins);
    rt.hist = Float64Array.from(histFromArray(p, bins));
    rt.clicks = pNum(p, 'hits', 0);
    rt.packets = pNum(p, 'packets', 0);
    rt.lastClear = pNum(p, 'clearToken', 0);
    rt.lastReset = useSimStore.getState().resetToken;
    rtRef.current = rt;

    const allowGpu = gpuCapable(useSimStore.getState().gpu);
    const build = (n: number): void => {
      if (allowGpu) {
        const el = document.createElement('canvas');
        el.className = CANVAS_CLASS;
        host.appendChild(el);
        const engine = createGpuEngine(el, n);
        if (engine) {
          rt.engine = engine;
          rt.el = el;
          return;
        }
        host.removeChild(el);
      }
      const el2 = document.createElement('canvas');
      el2.className = CANVAS_CLASS;
      host.appendChild(el2);
      const cpu = createCpuEngine(el2, cpuGridRes(n));
      if (cpu) {
        rt.engine = cpu;
        rt.el = el2;
      } else {
        host.removeChild(el2);
      }
    };
    build(requestGridRes(p));

    return () => {
      if (rt.engine) rt.engine.dispose();
      if (rt.el?.parentElement === host) host.removeChild(rt.el);
      rt.engine = null;
      rt.el = null;
      rtRef.current = null;
    };
  }, [slug, gridKey]);

  useAnimationClock(({ dt }) => {
    const rt = rtRef.current;
    const host = hostRef.current;
    const overlay = overlayRef.current;
    const engine = rt?.engine ?? null;
    if (!rt || !host || !overlay || !engine) return;
    const store = useSimStore.getState();
    const p = store.params[slug] ?? {};

    rt.clock += dt;
    const now = performance.now();
    const bins = Math.max(32, Math.min(MAX_BINS, Math.round(pNum(p, 'screenBins', 220))));
    if (bins !== rt.bins) {
      const next = new Float64Array(bins);
      for (let b = 0; b < Math.min(bins, rt.bins); b++) next[b] = rt.hist[b] ?? 0;
      rt.hist = next;
      rt.profile = new Float64Array(bins);
      rt.weights = new Float64Array(bins);
      rt.density = new Float32Array(bins);
      rt.flux = new Float32Array(bins);
      rt.bins = bins;
    }
    rt.rows = bins;

    const cfg = buildConfig(p, engine.N);
    const single = pBool(p, 'singleElectron', true);

    // Clear / reset: the inspector's Clear button, the shell reset, the start or
    // rewind of a guided tour, or the first frame after (re)building an engine.
    // A rebuild keeps the built-up pattern; a tour restart must not, because the
    // director ramps numeric keys from whatever the screen already holds.
    const script = store.demo.scriptId ?? '';
    const rewound = script !== '' && script === rt.lastScript && store.demo.t + 0.5 < rt.lastDemoT;
    const started = script !== '' && script !== rt.lastScript;
    rt.lastScript = script;
    rt.lastDemoT = store.demo.t;
    const clearToken = pNum(p, 'clearToken', 0);
    const fresh = !rt.ready;
    if (fresh) rt.ready = true;
    const wiped = started || rewound || clearToken !== rt.lastClear || store.resetToken !== rt.lastReset;
    // Changing the detector retunes the *ensemble*, so the old latent image no
    // longer describes it. Drop the histogram but keep the field: the pattern is
    // then seen to wash from sharp fringes into the classical two-hump sum as
    // unmarked electrons leave the stage and marked ones arrive.
    const tagKey = cfg.whichPath ? cfg.tagPhase : -1;
    const retuned = !Number.isNaN(rt.lastTag) && tagKey !== rt.lastTag;
    rt.lastTag = tagKey;
    if (fresh || wiped) {
      rt.lastClear = clearToken;
      rt.lastReset = store.resetToken;
      engine.reset(cfg);
      rt.emitAcc = 0;
      rt.expected = 0;
      if (!single) {
        engine.emit(cfg, 0);
      }
    }
    if (wiped || retuned) {
      rt.hist.fill(0);
      rt.dotHead = 0;
      rt.dotLive = 0;
      rt.clicks = 0;
      rt.vis = 0;
      rt.fringe = 0;
      rt.packets = single ? 0 : 1;
    }

    const steps = dt > 0 ? Math.max(0, Math.min(16, Math.round(cfg.stepsPerFrame * dt * 60))) : 0;
    if (steps > 0) {
      engine.advance(cfg, steps);
      if (single) {
        rt.emitAcc += dt * Math.max(0, pNum(p, 'emissionRate', 22));
        const phi = cfg.whichPath ? cfg.tagPhase : 0;
        while (rt.emitAcc >= 1) {
          rt.emitAcc -= 1;
          // One fresh electron, one coin toss: the ±φ mark rides on this packet.
          engine.emit(cfg, (Math.random() < 0.5 ? -1 : 1) * phi);
          rt.packets += 1;
        }
      }
    }

    rt.norm = engine.probe(cfg, rt.rows, rt.density, rt.flux);

    // Expected arrivals this frame = probability current through the detector
    // line × lattice time advanced, so the click train is earned, not scripted.
    // Each strip row stands for cfg.N / rows cells of the lattice, whatever the
    // strip resolution, because readStrip partitions the cells between the rows.
    const span = cfg.N / rt.rows;
    let wTot = 0;
    for (let r = 0; r < rt.rows; r++) {
      const f = rt.flux[r] ?? 0;
      const w = f > 0 ? f : 0;
      rt.weights[r] = w;
      wTot += w;
    }
    const arrivals = 0.5 * span * wTot * steps * cfg.dt;
    if (pBool(p, 'accumulate', true) && arrivals > 0) {
      if (single) {
        rt.expected += arrivals;
        const k = poissonCount(rt.expected, Math.random);
        rt.expected = Math.max(0, rt.expected - k);
        for (let c = 0; c < k; c++) {
          const r = pickBin(rt.weights, wTot, Math.random());
          if (r < 0) continue;
          const bin = Math.min(rt.bins - 1, Math.floor(((r + 0.5) / rt.rows) * rt.bins));
          rt.hist[bin] = (rt.hist[bin] ?? 0) + 1;
          rt.dotBin[rt.dotHead] = bin;
          rt.dotJit[rt.dotHead] = Math.random() * 2 - 1;
          rt.dotT[rt.dotHead] = rt.clock;
          rt.dotHead = (rt.dotHead + 1) % MAX_DOTS;
          rt.dotLive = Math.min(MAX_DOTS, rt.dotLive + 1);
          rt.clicks += 1;
        }
      } else {
        binStrip(rt.density, rt.bins, rt.profile);
        let tot = 0;
        for (let b = 0; b < rt.bins; b++) tot += rt.profile[b] ?? 0;
        if (tot > 0) {
          for (let b = 0; b < rt.bins; b++) rt.hist[b] = (rt.hist[b] ?? 0) + (arrivals * (rt.profile[b] ?? 0)) / tot;
          rt.clicks += Math.round(arrivals);
        }
      }
    }

    rt.vis = fringeVisibility(rt.hist, rt.bins);
    rt.fringe = measureFringeSpacing(rt.hist, rt.bins);

    /* -------------------------------- render ------------------------------- */
    const view = pStr(p, 'view', 'field');
    const el = rt.el;
    if (el) el.style.display = view === 'screen' ? 'none' : 'block';
    const size = overlayCtx(overlay, host);
    if (!size) return;
    const [ctx, W, H] = size;
    ctx.clearRect(0, 0, W, H);
    if (view !== 'screen' && el) {
      engine.draw(el, cfg, {
        contrast: pNum(p, 'contrast', 1.15),
        phaseColor: pBool(p, 'phaseColor', true),
        palette: store.prefs.palette === 'cividis' ? 1 : 0,
        showBarrier: pBool(p, 'showBarrier', true),
        fieldAlpha: 1,
      });
    }
    if (view === 'screen') {
      drawPhosphor(ctx, rt, cfg, 8, 8, W - 16, H - 16, true);
    } else if (view === 'both') {
      const pw = Math.min(340, Math.max(180, W * 0.34));
      drawPhosphor(ctx, rt, cfg, W - pw - 8, 8, pw, H - 16, true);
      drawHud(ctx, rt, cfg, H, engine.kind);
    } else {
      drawPhosphor(ctx, rt, cfg, 8, 8, Math.min(210, W * 0.42), Math.min(158, H * 0.52), false);
      drawHud(ctx, rt, cfg, H, engine.kind);
    }

    /* ------------------------------ mirror back ---------------------------- */
    if (now - rt.mirrorAt > MIRROR_MS) {
      rt.mirrorAt = now;
      store.setParams(slug, {
        hits: rt.clicks,
        packets: rt.packets,
        fieldNorm: Math.round(rt.norm * 1000) / 1000,
        measuredV: Math.round(rt.vis * 1000) / 1000,
        fringe: rt.fringe > 0 ? Math.round(rt.fringe * 1e5) / 1e5 : 0,
        engineLabel: `${engine.kind}·${engine.N}`,
      });
    }
    if (now - rt.histAt > HIST_MS) {
      rt.histAt = now;
      store.setParam(slug, 'screenHits', histToArray(rt.hist, rt.bins));
    }
  });

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={hostRef} className={CANVAS_CLASS} />
      <canvas ref={overlayRef} className={`${CANVAS_CLASS} pointer-events-none`} />
      <div className="pointer-events-none absolute right-3 top-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
        2D TDSE · RK4 Horner · ħ = mₑ = 1
      </div>
    </div>
  );
}
