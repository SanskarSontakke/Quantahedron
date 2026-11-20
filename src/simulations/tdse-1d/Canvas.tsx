'use client';

/**
 * Sim 3 — 1D TDSE Sandbox viewport.
 *
 * One Canvas-2D surface, driven by the shared rAF clock through refs: React never
 * re-renders to animate. The wavefunction it draws arrives from the Crank–Nicolson
 * Web Worker (`solver/useTdseSolver`); when no worker is available the same numbers
 * come back synchronously, so the picture is identical either way.
 *
 * Channels (keys 1–4 through the stage keyboard map, mirrored into `view`):
 *   density   |ψ(x,t)|² as phase-coloured columns (hue = arg ψ, brightness = |ψ|²)
 *             inside the V(x) skyline, with the diagonalised level ladder overlaid
 *             and each line weighted by its measured occupation |⟨φₖ|ψ⟩|².
 *   reim      Re ψ (cyan) and Im ψ (rose) about their axis — the raw complex field,
 *             which is what actually propagates, plus an |ψ|² ghost.
 *   spectrum  occupation bars per level next to the energy ladder, ⟨E⟩ marker, and
 *             |φ_top(x)|² of the most-occupied eigenstate drawn on the right.
 *   absorbing the same density on a log ramp with the complex-absorbing sponge
 *             highlighted: here norm is destroyed on purpose.
 *
 * With `potential = custom` the viewport doubles as an input device: drag to paint
 * V(x) on a {@link BRUSH_SAMPLES}-sample brush field that `buildPotential` resamples
 * onto the solver grid, while the packet keeps evolving in the shape you drew.
 */

import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { phaseColor, rgbCss, type Palette } from '@/lib/colorMap';
import { pArr, pBool, pNum, pStr, useSimStore } from '@/store/useSimStore';
import type { SimParams, SimSlug } from '@/simulations/types';
import { useTdseSolver, type TdseSolverState } from './solver/useTdseSolver';
import {
  BRUSH_SAMPLES,
  BOX_AU,
  TDSE_VIEWS,
  clampNum,
  eigenCountOf,
  liveTdse,
  publishLive,
  viewOf,
} from './model';

const ACCENT = '#38bdf8';
const GOLD = '#fbbf24';
const MINT = 'rgba(94,234,212,';
const DIM = 'rgba(148,163,184,0.35)';
const INK = 'rgba(226,232,240,0.92)';
const FAINT = 'rgba(148,163,184,0.62)';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const PHASE_STEPS = 72;
const ALPHA_STEPS = 10;

interface Geo {
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  plotW: number;
  plotH: number;
  baseY: number;
}

interface Chip {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Scale {
  eMax: number;
  eMin: number;
  clipped: boolean;
}

/** hue × alpha lookup so a frame allocates no colour strings. */
function buildLut(palette: Palette): string[] {
  const out: string[] = new Array<string>(PHASE_STEPS * ALPHA_STEPS);
  for (let i = 0; i < PHASE_STEPS; i++) {
    const c = phaseColor((i / PHASE_STEPS) * Math.PI * 2 - Math.PI, palette);
    for (let a = 0; a < ALPHA_STEPS; a++) out[i * ALPHA_STEPS + a] = rgbCss(c, (a + 1) / ALPHA_STEPS);
  }
  return out;
}

/** 3 decimals matches `urlState.encodeParams`, so a permalink round-trips exactly. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function driftText(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v === 0 ? '0' : v.toExponential(1);
}

function hashArray(arr: number[]): string {
  let hash = 0;
  for (let i = 0; i < arr.length; i++) hash = (hash * 31 + Math.round(arr[i] * 1000)) | 0;
  return `${arr.length}:${hash}`;
}

export default function TdseCanvas({ slug }: { slug: SimSlug }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const chipsRef = useRef<Chip[]>([]);
  const brushRef = useRef<Float64Array>(new Float64Array(BRUSH_SAMPLES));
  const brushSigRef = useRef<string>('\u0000');
  const brushDirtyRef = useRef(false);
  const brushCommitRef = useRef(0);
  const paintRef = useRef(false);
  const cursorRef = useRef({ u: 0, v: 0, inside: false });
  const fpsRef = useRef(0);
  const lastTickRef = useRef(0);
  const viewMirrorRef = useRef({ view: 'density', render: 'density' });
  const firstResetRef = useRef(true);
  const scratchRef = useRef({ dens: new Float64Array(0), phase: new Float64Array(0) });

  const solver = useTdseSolver();
  const palette = useSimStore((s) => s.prefs.palette);
  const resetToken = useSimStore((s) => s.resetToken);
  const params = useSimStore((s) => s.params[slug]);
  const interruptDemo = useSimStore((s) => s.interruptDemo);
  const setParams = useSimStore((s) => s.setParams);
  const setParam = useSimStore((s) => s.setParam);
  const lut = useMemo(() => buildLut(palette), [palette]);

  const live = useCallback((): SimParams => useSimStore.getState().params[slug] ?? {}, [slug]);

  /* ------------------------------- geometry -------------------------------- */

  const geometry = useCallback((): Geo => {
    const { w, h } = sizeRef.current;
    const st = useSimStore.getState();
    const wide = st.inspectorOpen && w > 900;
    const left = 54;
    const right = Math.max(left + 120, w - (wide ? 344 : 18));
    const top = 78;
    const hudH = h > 470 ? 44 : 30;
    const bottom = Math.max(top + 120, h - hudH - 12);
    return {
      w,
      h,
      left,
      right,
      top,
      bottom,
      plotW: Math.max(60, right - left),
      plotH: Math.max(70, bottom - top),
      baseY: bottom - 4,
    };
  }, []);

  const resize = useCallback(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const w = Math.max(280, Math.round(rect.width));
    const h = Math.max(260, Math.round(rect.height));
    sizeRef.current = { w, h, dpr };
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
  }, []);

  useEffect(() => {
    resize();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(host);
    return () => ro.disconnect();
  }, [resize]);

  /* ---------------------------- brush bookkeeping -------------------------- */

  /** Adopt the store's brush array whenever it changed from the outside. */
  const syncBrush = useCallback((p: SimParams): void => {
    const arr = pArr(p, 'customV');
    const sig = hashArray(arr);
    if (sig === brushSigRef.current) return;
    brushSigRef.current = sig;
    const buf = brushRef.current;
    if (arr.length === BRUSH_SAMPLES) {
      for (let i = 0; i < BRUSH_SAMPLES; i++) buf[i] = arr[i];
      return;
    }
    for (let i = 0; i < BRUSH_SAMPLES; i++) {
      if (arr.length === 0) {
        buf[i] = 0;
        continue;
      }
      const t = arr.length > 1 ? (i / (BRUSH_SAMPLES - 1)) * (arr.length - 1) : 0;
      const lo = Math.floor(t);
      const hi = Math.min(arr.length - 1, lo + 1);
      buf[i] = arr[lo] + (arr[hi] - arr[lo]) * (t - lo);
    }
  }, []);

  const commitBrush = useCallback(
    (force: boolean): void => {
      const now = performance.now();
      if (!force && now - brushCommitRef.current < 45) return;
      brushCommitRef.current = now;
      brushDirtyRef.current = false;
      const out = new Array<number>(BRUSH_SAMPLES);
      for (let i = 0; i < BRUSH_SAMPLES; i++) out[i] = round3(brushRef.current[i]);
      brushSigRef.current = hashArray(out);
      setParams(slug, { customV: out });
    },
    [setParams, slug],
  );

  /** Gaussian-feathered stamp: blends the brush field toward `target`. */
  const stamp = useCallback((u: number, target: number, radius: number): void => {
    const buf = brushRef.current;
    const r = Math.max(0.004, radius);
    const reach = 3 * r * (BRUSH_SAMPLES - 1);
    const c = u * (BRUSH_SAMPLES - 1);
    const lo = Math.max(0, Math.floor(c - reach));
    const hi = Math.min(BRUSH_SAMPLES - 1, Math.ceil(c + reach));
    for (let i = lo; i <= hi; i++) {
      const d = (i / (BRUSH_SAMPLES - 1) - u) / r;
      const g = Math.exp(-0.5 * d * d);
      if (g < 0.002) continue;
      buf[i] = buf[i] * (1 - g) + g * target;
    }
    brushDirtyRef.current = true;
  }, []);

  /* ------------------------------- rendering ------------------------------- */

  const energyScale = useCallback((p: SimParams, v: Float64Array, energy: number): Scale => {
    let maxV = 0;
    for (let j = 0; j < v.length; j++) if (v[j] > maxV) maxV = v[j];
    const kind = pStr(p, 'potential', 'double');
    const ref = kind === 'kronig' ? Math.max(pNum(p, 'latticeDepth', 6), Math.min(maxV, 60)) : pNum(p, 'V0', 8);
    let top = Math.max(ref * 1.25, Math.abs(energy) * 1.7, 2);
    if (maxV <= 60) top = Math.max(top, maxV * 1.08);
    return { eMax: top, eMin: -0.12 * top, clipped: maxV > top };
  }, []);

  const drawChrome = useCallback((ctx: CanvasRenderingContext2D, g: Geo, p: SimParams, st: TdseSolverState): void => {
    const chips: Chip[] = [];
    let x = g.left;
    const y = 26;
    const h = 22;
    const current = viewOf(p);
    ctx.font = `600 11px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const v of TDSE_VIEWS) {
      const label =
        v === 'density' ? '1 |ψ|²' : v === 'reim' ? '2 Re/Im' : v === 'spectrum' ? '3 spectrum' : '4 sponge';
      const w = Math.max(56, ctx.measureText(label).width + 18);
      const active = v === current;
      ctx.fillStyle = active ? 'rgba(56,189,248,0.18)' : 'rgba(148,163,184,0.07)';
      ctx.strokeStyle = active ? 'rgba(56,189,248,0.7)' : 'rgba(148,163,184,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? INK : FAINT;
      ctx.fillText(label, x + 9, y + h / 2 + 0.5);
      chips.push({ id: `view:${v}`, x, y, w, h });
      x += w + 6;
    }
    if (pStr(p, 'potential', 'double') === 'custom') {
      const erase = pBool(p, 'brushErase', false);
      const buttons: [string, string, boolean][] = [
        ['brush:clear', 'clear V', false],
        ['brush:erase', erase ? 'erase: on' : 'erase: off', erase],
      ];
      for (const [id, label, active] of buttons) {
        const w = Math.max(50, ctx.measureText(label).width + 18);
        ctx.fillStyle = active ? 'rgba(251,191,36,0.16)' : 'rgba(148,163,184,0.07)';
        ctx.strokeStyle = active ? 'rgba(251,191,36,0.6)' : 'rgba(148,163,184,0.2)';
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 11);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = active ? INK : FAINT;
        ctx.fillText(label, x + 9, y + h / 2 + 0.5);
        chips.push({ id, x, y, w, h });
        x += w + 6;
      }
    }
    chipsRef.current = chips;

    ctx.fillStyle = INK;
    ctx.font = `600 13px ${MONO}`;
    ctx.fillText('TDSE   iℏ ∂ₜψ = [ −ℏ²/2m ∂²ₓ + V(x) ] ψ', g.left, 10);
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = FAINT;
    const setup = st.setup;
    const badge = st.worker ? 'Crank–Nicolson · Web Worker' : 'Crank–Nicolson · main thread';
    ctx.fillText(
      `${badge}   ${setup ? `N=${setup.n}` : ''}   ${eigenCountOf(p)} levels`,
      g.left,
      58,
    );
  }, []);

  const drawAxes = useCallback((ctx: CanvasRenderingContext2D, g: Geo, sc: Scale, yFor: (e: number) => number): void => {
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.left, g.baseY + 0.5);
    ctx.lineTo(g.right, g.baseY + 0.5);
    ctx.stroke();

    ctx.font = `10px ${MONO}`;
    ctx.textBaseline = 'middle';
    const span = sc.eMax - sc.eMin;
    for (let i = 0; i <= 4; i++) {
      const e = sc.eMin + (span * i) / 4;
      const y = yFor(e);
      ctx.textAlign = 'right';
      ctx.fillStyle = FAINT;
      ctx.fillText(e.toFixed(1), g.left - 8, y);
      if (i > 0) {
        ctx.strokeStyle = 'rgba(148,163,184,0.08)';
        ctx.beginPath();
        ctx.moveTo(g.left, y);
        ctx.lineTo(g.right, y);
        ctx.stroke();
      }
    }
    ctx.save();
    ctx.translate(14, (g.top + g.baseY) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = FAINT;
    ctx.fillText('energy (a.u.)', 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.fillStyle = FAINT;
    ctx.fillText(`x ∈ [−${(BOX_AU / 2).toFixed(1)}, +${(BOX_AU / 2).toFixed(1)}]`, g.left, g.baseY + 14);
  }, []);

  const drawPotential = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, v: Float64Array, sc: Scale, yFor: (e: number) => number, meanE: number): void => {
      const n = v.length;
      const dxPix = g.plotW / n;
      ctx.beginPath();
      ctx.moveTo(g.left, g.baseY);
      for (let j = 0; j < n; j++) {
        const y = yFor(Math.min(v[j], sc.eMax));
        const x = g.left + j * dxPix;
        ctx.lineTo(x, y);
        ctx.lineTo(x + dxPix, y);
      }
      ctx.lineTo(g.right, g.baseY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,140,170,0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(148,163,184,0.6)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      /* classically forbidden columns for the current ⟨E⟩ */
      ctx.fillStyle = 'rgba(251,191,36,0.10)';
      for (let j = 0; j < n; j++) {
        if (v[j] <= meanE) continue;
        ctx.fillRect(g.left + j * dxPix, yFor(sc.eMax), Math.max(1, dxPix), g.baseY - yFor(sc.eMax));
      }
      if (sc.clipped) {
        ctx.fillStyle = FAINT;
        ctx.font = `10px ${MONO}`;
        ctx.fillText('V(x) clipped at the window top', g.left + 6, g.top + 10);
      }
    },
    [],
  );

  const drawSponge = useCallback((ctx: CanvasRenderingContext2D, g: Geo, cap: Float64Array): void => {
    const n = cap.length;
    let capPeak = 0;
    for (let j = 0; j < n; j++) if (cap[j] > capPeak) capPeak = cap[j];
    if (capPeak <= 0) return;
    const dxPix = g.plotW / n;
    for (let j = 0; j < n; j++) {
      const w = cap[j];
      if (w <= 0) continue;
      ctx.fillStyle = `rgba(251,113,133,${(0.05 + 0.3 * (w / capPeak)).toFixed(3)})`;
      ctx.fillRect(g.left + j * dxPix, g.top, Math.max(1, dxPix), g.plotH);
    }
    ctx.fillStyle = 'rgba(251,113,133,0.9)';
    ctx.font = `10px ${MONO}`;
    ctx.fillText('−iW(x) absorbing sponge  ψ ← e^(−Δt·W/ℏ) ψ', g.left + 6, g.top + 26);
  }, []);

  const drawDensity = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      g: Geo,
      p: SimParams,
      st: TdseSolverState,
      yFor: (e: number) => number,
      sc: Scale,
      table: string[],
      logMode: boolean,
    ): void => {
      const setup = st.setup;
      if (!setup) return;
      const { n, dx } = setup;
      const re = st.frame.re;
      const im = st.frame.im;
      if (re.length !== n || im.length !== n) return;
      const scratch = scratchRef.current;
      if (scratch.dens.length !== n) {
        scratch.dens = new Float64Array(n);
        scratch.phase = new Float64Array(n);
      }
      const dens = scratch.dens;
      const phase = scratch.phase;
      let peak = 1e-30;
      for (let j = 0; j < n; j++) {
        const d = (re[j] * re[j] + im[j] * im[j]) * dx;
        dens[j] = d;
        phase[j] = Math.atan2(im[j], re[j]);
        if (d > peak) peak = d;
      }
      const ref = Math.max(peak, setup.peak0 * 0.3, 1e-12);
      const exposure = clampNum(pNum(p, 'yScale', 1), 0.1, 6);
      const colorPhase = pBool(p, 'colorPhase', true);
      const densityH = g.plotH * 0.62;
      const dxPix = g.plotW / n;
      const baseY = g.baseY;

      /* eigen ladder, line weight = measured occupation |⟨φₖ|ψ⟩|² */
      const spec = st.spectrum;
      const weights = st.frame.weights;
      if (pBool(p, 'showEigen', true) && spec.count > 0 && spec.energies.length === spec.count) {
        ctx.font = `9px ${MONO}`;
        ctx.textAlign = 'right';
        for (let k = 0; k < spec.count; k++) {
          const e = spec.energies[k];
          if (e > sc.eMax) continue;
          const y = yFor(e);
          if (y < g.top - 1) continue;
          const wgt = weights.length > k ? weights[k] : 0;
          ctx.strokeStyle = `${MINT}${(0.14 + 0.6 * Math.min(1, wgt)).toFixed(3)})`;
          ctx.lineWidth = 0.8 + 2.6 * Math.min(1, wgt);
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(g.left, y);
          ctx.lineTo(g.right, y);
          ctx.stroke();
          ctx.setLineDash([]);
          if (wgt > 0.03) {
            ctx.fillStyle = `${MINT}0.85)`;
            ctx.fillText(`|⟨φ${k}|ψ⟩|² = ${(wgt * 100).toFixed(0)}%`, g.right - 4, y - 6);
          }
        }
        ctx.textAlign = 'left';
      }

      /* |ψ|² columns */
      for (let j = 0; j < n; j++) {
        let q = dens[j] / ref;
        if (logMode) q = Math.log10(1 + 9 * q);
        q = clampNum(q * exposure, 0, 1);
        if (q < 0.0015) continue;
        const hpx = q * densityH;
        const x = g.left + j * dxPix;
        if (colorPhase) {
          const pi = clampNum(Math.floor(((phase[j] + Math.PI) / (Math.PI * 2)) * PHASE_STEPS), 0, PHASE_STEPS - 1);
          const ai = clampNum(Math.floor(q * ALPHA_STEPS), 0, ALPHA_STEPS - 1);
          ctx.fillStyle = table[pi * ALPHA_STEPS + ai];
        } else {
          ctx.fillStyle = `rgba(56,189,248,${(0.1 + 0.8 * q).toFixed(3)})`;
        }
        ctx.fillRect(x, baseY - hpx, Math.max(1, dxPix + 0.6), hpx);
      }

      /* envelope */
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        let q = dens[j] / ref;
        if (logMode) q = Math.log10(1 + 9 * q);
        q = clampNum(q * exposure, 0, 1);
        const x = g.left + (j + 0.5) * dxPix;
        const y = baseY - q * densityH;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = logMode ? 'rgba(251,191,36,0.95)' : 'rgba(56,189,248,0.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      /* ⟨x⟩ marker */
      const diag = st.frame.diag;
      if (diag) {
        const ux = diag.x / BOX_AU + 0.5;
        if (ux >= 0 && ux <= 1) {
          const x = g.left + ux * g.plotW;
          ctx.strokeStyle = 'rgba(226,232,240,0.45)';
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(x, g.top);
          ctx.lineTo(x, baseY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = INK;
          ctx.font = `10px ${MONO}`;
          ctx.fillText('⟨x⟩', x + 4, baseY - densityH - 12);
        }
      }
      ctx.fillStyle = FAINT;
      ctx.font = `10px ${MONO}`;
      ctx.fillText(
        logMode
          ? '|ψ(x,t)|²  (log ramp, 1 decade)   hue = arg ψ'
          : '|ψ(x,t)|²   hue = arg ψ   dashed = eigen ladder',
        g.left + 6,
        g.top + (pStr(p, 'potential', 'double') === 'custom' ? 40 : 12),
      );
    },
    [],
  );

  const drawReIm = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, p: SimParams, st: TdseSolverState): void => {
      const setup = st.setup;
      if (!setup) return;
      const { n, dx } = setup;
      const re = st.frame.re;
      const im = st.frame.im;
      if (re.length !== n || im.length !== n) return;
      let peak = 1e-30;
      for (let j = 0; j < n; j++) {
        const a = Math.abs(re[j]);
        const b = Math.abs(im[j]);
        if (a > peak) peak = a;
        if (b > peak) peak = b;
      }
      const exposure = clampNum(pNum(p, 'yScale', 1), 0.1, 6);
      const amp = g.plotH * 0.33 * exposure;
      const midY = g.baseY - g.plotH * 0.4;
      const dxPix = g.plotW / n;

      ctx.strokeStyle = 'rgba(148,163,184,0.3)';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(g.left, midY);
      ctx.lineTo(g.right, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      /* |ψ|² envelope ghost */
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const d = (re[j] * re[j] + im[j] * im[j]) * dx;
        const q = clampNum(d / Math.max(1e-30, peak * peak * dx), 0, 1);
        const x = g.left + (j + 0.5) * dxPix;
        const y = midY - q * g.plotH * 0.28;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(56,189,248,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const curve = (buf: Float64Array, color: string, width: number): void => {
        ctx.beginPath();
        for (let j = 0; j < n; j++) {
          const x = g.left + (j + 0.5) * dxPix;
          const y = midY - (buf[j] / peak) * amp;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
      };
      if (pBool(p, 'showImag', true)) curve(im, 'rgba(251,113,133,0.9)', 1.1);
      if (pBool(p, 'showReal', true)) curve(re, ACCENT, 1.8);

      const legend: string[] = [];
      if (pBool(p, 'showReal', true)) legend.push('Re ψ');
      if (pBool(p, 'showImag', true)) legend.push('Im ψ');
      ctx.fillStyle = FAINT;
      ctx.font = `10px ${MONO}`;
      ctx.fillText(`${legend.join('  ·  ')}   (ghost = |ψ|²)`, g.left + 6, g.top + 12);
    },
    [],
  );

  const drawSpectrum = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      g: Geo,
      st: TdseSolverState,
      yFor: (e: number) => number,
      sc: Scale,
    ): void => {
      const setup = st.setup;
      const spec = st.spectrum;
      const weights = st.frame.weights;
      if (!setup) return;
      const ladderW = Math.min(330, g.plotW * 0.44);
      const rightX = g.left + ladderW + 30;
      const rightW = Math.max(60, g.right - rightX);
      const n = setup.n;

      if (spec.count === 0 || spec.states.length < n) {
        ctx.fillStyle = FAINT;
        ctx.font = `12px ${MONO}`;
        ctx.fillText('diagonalising H on the solver grid…', g.left, g.top + 16);
        return;
      }

      ctx.font = `10px ${MONO}`;
      let best = -1;
      let bestW = 0;
      for (let k = 0; k < spec.count; k++) {
        const wgt = weights.length > k ? weights[k] : 0;
        if (wgt > bestW) {
          bestW = wgt;
          best = k;
        }
        const e = spec.energies[k];
        const y = yFor(e);
        if (y < g.top + 6 || y > g.baseY) continue;
        ctx.strokeStyle = 'rgba(148,163,184,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.left, y);
        ctx.lineTo(g.left + 20, y);
        ctx.stroke();
        const bar = clampNum(wgt, 0, 1) * (ladderW - 84);
        ctx.fillStyle = wgt > 0.001 ? 'rgba(56,189,248,0.8)' : 'rgba(56,189,248,0.14)';
        ctx.fillRect(g.left + 24, y - 3, Math.max(1, bar), 6);
        ctx.textAlign = 'left';
        ctx.fillStyle = wgt > 0.02 ? INK : FAINT;
        ctx.fillText(`k=${k}`, g.left, y - 8);
        ctx.textAlign = 'right';
        ctx.fillStyle = FAINT;
        ctx.fillText(`E=${e.toFixed(2)}`, g.left + ladderW, y - 8);
        if (wgt > 0.02) {
          ctx.textAlign = 'left';
          ctx.fillStyle = `${MINT}0.95)`;
          ctx.fillText(`${(wgt * 100).toFixed(1)}%`, g.left + 28 + bar, y - 8);
        }
      }
      ctx.textAlign = 'left';

      const diag = st.frame.diag;
      if (diag) {
        const y = yFor(diag.energy);
        if (y > g.top && y < g.baseY) {
          ctx.strokeStyle = GOLD;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(g.left, y);
          ctx.lineTo(g.left + ladderW, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = GOLD;
          ctx.font = `10px ${MONO}`;
          ctx.fillText(`⟨E⟩ = ${diag.energy.toFixed(3)}`, g.left + 4, y + 11);
        }
      }

      /* the most-occupied eigenfunction, drawn over V(x) on the right */
      const k = Math.max(0, best);
      const dxPix = rightW / n;
      let peak = 1e-30;
      for (let j = 0; j < n; j++) {
        const a = spec.states[k * n + j];
        const d = a * a * setup.dx;
        if (d > peak) peak = d;
      }
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const a = spec.states[k * n + j];
        const d = a * a * setup.dx;
        const x = rightX + j * dxPix;
        const y = g.baseY - clampNum(d / peak, 0, 1) * g.plotH * 0.62;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(rightX + rightW, g.baseY);
      ctx.lineTo(rightX, g.baseY);
      ctx.closePath();
      ctx.fillStyle = `${MINT}0.16)`;
      ctx.fill();
      ctx.strokeStyle = `${MINT}0.9)`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = FAINT;
      ctx.font = `10px ${MONO}`;
      ctx.fillText(
        `|φ_${k}(x)|²  —  ${(bestW * 100).toFixed(1)}% of ψ   (E window ${sc.eMin.toFixed(1)} … ${sc.eMax.toFixed(1)})`,
        rightX + 2,
        g.top + 10,
      );
      if (st.spectrum.computeMs > 0) {
        ctx.fillText(`diagonalisation ${st.spectrum.computeMs.toFixed(1)} ms`, rightX + 2, g.top + 24);
      }
    },
    [],
  );

  const drawHud = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, st: TdseSolverState): void => {
      const diag = st.frame.diag;
      if (diag && st.setup) {
        publishLive(
          diag,
          st.setup.norm0,
          st.frame.drained,
          st.frame.weights,
          st.spectrum.energies.length ? st.spectrum.energies : null,
        );
      }
      liveTdse.worker = st.worker;
      liveTdse.t = st.frame.simTime;
      liveTdse.steps = st.frame.steps;
      liveTdse.diagMs = st.frame.computeMs;
      liveTdse.fps = fpsRef.current;
      liveTdse.eigenCount = st.spectrum.count;
      liveTdse.lastFrameMs = st.lastDelivery;
      const setup = st.setup;
      const norm = liveTdse.norm;
      const drift = liveTdse.drift;
      const drained = liveTdse.drained;
      const top = liveTdse.topLevel;
      const topW = liveTdse.topWeight;

      const y = g.bottom + 16;
      const cells: [string, string][] = [
        ['t', st.frame.simTime.toFixed(2)],
        ['‖ψ‖', norm.toFixed(7)],
        ['drift', driftText(drift)],
        ['sponge', drained > 1e-9 ? `−${drained.toExponential(2)}` : '0'],
        ['⟨x⟩', diag ? diag.x.toFixed(3) : '—'],
        ['⟨p⟩', diag ? diag.p.toFixed(3) : '—'],
        ['⟨E⟩', diag ? diag.energy.toFixed(3) : '—'],
        ['top', top >= 0 ? `|φ${top}⟩ ${(topW * 100).toFixed(0)}%` : '—'],
        ['fps', fpsRef.current.toFixed(0)],
        ['solve', `${st.frame.computeMs.toFixed(2)} ms/f`],
        ['grid', setup ? `N ${setup.n} · dx ${setup.dx.toFixed(4)}` : '—'],
      ];
      ctx.font = `10px ${MONO}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      let x = g.left;
      for (const [label, value] of cells) {
        if (x > g.right - 40) break;
        ctx.fillStyle = FAINT;
        ctx.fillText(label, x, y);
        const lw = ctx.measureText(label).width + 4;
        ctx.fillStyle = label === 'drift' ? (drift < 1e-5 ? `${MINT}0.95)` : 'rgba(251,191,36,0.95)') : INK;
        ctx.fillText(value, x + lw, y);
        x += lw + ctx.measureText(value).width + 14;
      }
    },
    [],
  );

  const drawBrushCursor = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, p: SimParams): void => {
      if (pStr(p, 'potential', 'double') !== 'custom' || !cursorRef.current.inside) return;
      const x = g.left + cursorRef.current.u * g.plotW;
      const r = clampNum(pNum(p, 'brushSize', 0.05), 0.005, 0.4) * g.plotW;
      ctx.save();
      ctx.strokeStyle = pBool(p, 'brushErase', false) ? 'rgba(251,191,36,0.85)' : 'rgba(56,189,248,0.85)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, g.top + g.plotH * 0.5, Math.max(4, r / 2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },
    [],
  );

  const drawFrame = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, p: SimParams): void => {
      const st = solver.stateRef.current;
      const setup = st.setup;
      const view = viewOf(p);
      const logMode = view === 'absorbing' || pBool(p, 'logDensity', false);
      const diag = st.frame.diag;
      const energy = diag ? diag.energy : 0;
      const v = setup ? setup.v : null;
      const sc = v ? energyScale(p, v, energy) : { eMax: 10, eMin: -1.2, clipped: false };
      const span = Math.max(1e-9, sc.eMax - sc.eMin);
      const yFor = (e: number): number => g.baseY - ((clampNum(e, sc.eMin, sc.eMax * 1.2) - sc.eMin) / span) * (g.plotH - 12);

      drawAxes(ctx, g, sc, yFor);
      if (!setup || !v || setup.n === 0) {
        ctx.fillStyle = FAINT;
        ctx.font = `12px ${MONO}`;
        ctx.fillText('initialising solver…', g.left, g.top + 16);
        return;
      }
      if (view !== 'spectrum' && pBool(p, 'showPotential', true)) {
        drawPotential(ctx, g, v, sc, yFor, energy);
      }
      if (view === 'absorbing' && setup.cap) drawSponge(ctx, g, setup.cap);
      if (view === 'spectrum') drawSpectrum(ctx, g, st, yFor, sc);
      else if (view === 'reim') drawReIm(ctx, g, p, st);
      else drawDensity(ctx, g, p, st, yFor, sc, lut, logMode);
      drawHud(ctx, g, st);
      drawBrushCursor(ctx, g, p);
    },
    [drawAxes, drawBrushCursor, drawDensity, drawHud, drawPotential, drawReIm, drawSponge, drawSpectrum, energyScale, lut, solver],
  );

  /* ------------------------------- the clock ------------------------------- */

  const tick = useCallback(
    (info: { dt: number }): void => {
      const canvas = canvasRef.current;
      const ctx = canvas ? canvas.getContext('2d') : null;
      if (!ctx) return;
      const now = performance.now();
      if (lastTickRef.current > 0) {
        const inst = 1000 / Math.max(1e-3, now - lastTickRef.current);
        fpsRef.current = fpsRef.current === 0 ? inst : fpsRef.current * 0.9 + inst * 0.1;
      }
      lastTickRef.current = now;

      const { dpr, w, h } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, 'rgba(56,189,248,0.07)');
      bg.addColorStop(0.55, 'rgba(8,12,20,0)');
      bg.addColorStop(1, 'rgba(2,4,9,0.6)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const store = useSimStore.getState();
      let p = store.params[slug] ?? {};
      syncBrush(p);

      /* Keys 1–4 write `render`; the select writes `view`. Mirror whichever moved. */
      const view = pStr(p, 'view', 'density');
      const render = pStr(p, 'render', view);
      const prev = viewMirrorRef.current;
      let effective = view;
      if (render !== view) {
        if (render !== prev.render) {
          effective = render;
          setParam(slug, 'view', render);
          p = useSimStore.getState().params[slug] ?? p;
        } else if (view !== prev.view) {
          setParam(slug, 'render', view);
        }
      }
      viewMirrorRef.current = { view, render };

      if (brushDirtyRef.current) commitBrush(false);

      const pp = effective === view ? p : { ...p, view: effective };
      if (info.dt > 0 && store.playing) {
        const per = Math.round(clampNum(pNum(pp, 'stepsPerFrame', 3), 1, 40));
        const rate = clampNum(info.dt * 60 * store.timeScale, 0.2, 4);
        solver.pump(pp, Math.max(1, Math.round(per * rate)));
      } else {
        solver.pump(pp, 0);
      }

      const st = solver.stateRef.current;

      const g = geometry();
      drawChrome(ctx, g, pp, st);
      drawFrame(ctx, g, pp);
    },
    [commitBrush, drawChrome, drawFrame, geometry, setParam, slug, solver, syncBrush],
  );

  useAnimationClock(tick, { maxDt: 0.05 });

  /* ---------------------------- reset (R key) ------------------------------ */

  useEffect(() => {
    if (firstResetRef.current) {
      firstResetRef.current = false;
      return;
    }
    solver.reset(live());
  }, [resetToken, solver, live]);

  /* -------------------------------- pointer -------------------------------- */

  const brushTarget = useCallback((p: SimParams): number => {
    const kind = pStr(p, 'potential', 'double');
    const ref = kind === 'kronig' ? pNum(p, 'latticeDepth', 6) : pNum(p, 'V0', 8);
    return Math.max(1, ref);
  }, []);

  const onPointerDown = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>): void => {
      const rect = ev.currentTarget.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      for (const chip of chipsRef.current) {
        if (px >= chip.x && px <= chip.x + chip.w && py >= chip.y && py <= chip.y + chip.h) {
          if (chip.id.startsWith('view:')) setParam(slug, 'view', chip.id.slice(5));
          else if (chip.id === 'brush:erase') setParam(slug, 'brushErase', !pBool(live(), 'brushErase', false));
          else if (chip.id === 'brush:clear') {
            brushRef.current.fill(0);
            commitBrush(true);
          }
          return;
        }
      }
      const p = live();
      if (pStr(p, 'potential', 'double') !== 'custom') return;
      const g = geometry();
      if (px < g.left || px > g.right || py < g.top || py > g.bottom) return;
      paintRef.current = true;
      interruptDemo();
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
      stamp(
        clampNum((px - g.left) / g.plotW, 0, 1),
        pBool(p, 'brushErase', false) ? 0 : brushTarget(p),
        clampNum(pNum(p, 'brushSize', 0.05), 0.005, 0.4),
      );
      commitBrush(true);
    },
    [brushTarget, commitBrush, geometry, interruptDemo, live, setParam, slug, stamp],
  );

  const onPointerMove = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>): void => {
      const rect = ev.currentTarget.getBoundingClientRect();
      const g = geometry();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      cursorRef.current = {
        u: clampNum((px - g.left) / g.plotW, 0, 1),
        v: py,
        inside: px >= g.left && px <= g.right && py >= g.top && py <= g.bottom,
      };
      if (!paintRef.current) return;
      const p = live();
      stamp(
        cursorRef.current.u,
        pBool(p, 'brushErase', false) ? 0 : brushTarget(p),
        clampNum(pNum(p, 'brushSize', 0.05), 0.005, 0.4),
      );
    },
    [brushTarget, geometry, live, stamp],
  );

  const onPointerUp = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>): void => {
      cursorRef.current.inside = false;
      if (!paintRef.current) return;
      paintRef.current = false;
      commitBrush(true);
      try {
        ev.currentTarget.releasePointerCapture?.(ev.pointerId);
      } catch {
        /* pointer already released */
      }
    },
    [commitBrush],
  );

  const custom = pStr(params, 'potential', 'double') === 'custom';
  const emptyBrush = pArr(params, 'customV').every((v) => Math.abs(v) < 1e-6);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden bg-obsidian"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ touchAction: 'none' }}
      role="application"
      aria-label="Time-dependent Schrödinger equation sandbox: Crank–Nicolson wavefunction evolution"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block" />
      {custom && emptyBrush ? (
        <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] text-ink-faint">
          drag to paint V(x) — the packet keeps evolving
        </div>
      ) : null}
    </div>
  );
}
