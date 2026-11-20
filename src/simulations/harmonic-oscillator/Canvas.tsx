'use client';

/**
 * Harmonic Oscillator — stage viewport.
 *
 * One 2D canvas, driven entirely by the shared rAF clock and refs: React never
 * re-renders to animate.  Every curve is the analytic Hermite–Gauss state
 * evaluated at time t through the exact propagator cₙ → cₙe^{−i(n+½)ωt}, so what
 * is drawn *is* the solution rather than an approximation of it.
 *
 * Channels
 *   density  |ψ(x,t)|² sitting on its own ⟨E⟩ line inside V(x) = ½ω²x², with the
 *            classical density 1/(π√(A²−x²)) overlaid on the same scale and
 *            |x| > A shaded as classically forbidden.
 *   reim     Re ψ (solid) and Im ψ (thin) about that baseline.
 *   phase    a hue ribbon: arg ψ → hue, |ψ|² → brightness.
 *   wiggle   1D: the Wigner function W(x,p) from its definition, with the
 *            classical energy shell over it.  2D: the current J = Im(Ψ*∇Ψ).
 *
 * 2D mode composites |Ψ(x,y)|² into an offscreen bitmap and blits it, so the
 * heatmap costs one putImageData per frame instead of 60 000 fillRects.
 */

import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { phaseColor, type Palette } from '@/lib/colorMap';
import { pBool, pNum, useSimStore } from '@/store/useSimStore';
import type { SimParams, SimSlug } from '@/simulations/types';
import { Dock } from './Panels';
import { oscView } from './controls';
import {
  TRAIL,
  classicalDensity,
  compose2D,
  current2D,
  dimOf,
  evaluateWave,
  moments,
  oscPort,
  potential,
  propagate,
  pushTrail,
  state2D,
  stateCoeffs,
  turningAmplitude,
  wignerEvaluate,
  wignerPlan,
  type Coeffs,
  type WignerPlan,
} from './physics';

const TAU = Math.PI * 2;
const HUE = 256;
/** Wigner grid: 64×64 output samples, 96 points in the y-integral. */
const WIG = 64;
const WIG_Y = 96;
/** Offscreen heatmap edge length for the 2D channel. */
const FIELD_2D = 168;

const ACCENT = { r: 0.204, g: 0.827, b: 0.6 }; // #34d399 — W ≥ 0
const NEGATIVE = { r: 0.984, g: 0.443, b: 0.545 }; // #fb7185 — W < 0
const BG = { r: 0.02, g: 0.027, b: 0.047 }; // obsidian

interface Geo {
  w: number;
  h: number;
  dpr: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

interface Off {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  size: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Precomputed twilight wheel: one lookup per heatmap pixel instead of a ramp sample. */
function useHueLut(palette: Palette): Float32Array {
  return useMemo(() => {
    const lut = new Float32Array(HUE * 3);
    for (let i = 0; i < HUE; i++) {
      const c = phaseColor((i / HUE) * TAU - Math.PI, palette);
      lut[i * 3] = c.r;
      lut[i * 3 + 1] = c.g;
      lut[i * 3 + 2] = c.b;
    }
    return lut;
  }, [palette]);
}

export default function OscillatorCanvas({ slug }: { slug: SimSlug }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const offRef = useRef<Off | null>(null);
  const planRef = useRef<{ plan: WignerPlan; omega: number; xMax: number } | null>(null);
  const wigRef = useRef<HTMLCanvasElement | null>(null);
  const wigAccum = useRef(1e9);
  const wigMax = useRef(0);
  const dragRef = useRef(false);

  const params = useSimStore((s) => s.params[slug]);
  const palette = useSimStore((s) => s.prefs.palette);
  const resetToken = useSimStore((s) => s.resetToken);
  const setParams = useSimStore((s) => s.setParams);
  const interruptDemo = useSimStore((s) => s.interruptDemo);
  const twoD = dimOf(params) === 2;
  const coherent = pBool(params, 'coherent', false);
  const dockOn = pBool(params, 'showLadder', true) || (pBool(params, 'showPhaseSpace', true) && !twoD);

  const lut = useHueLut(palette);

  useEffect(() => {
    oscPort.t = 0;
    oscPort.clearTrail = true;
    wigAccum.current = 1e9;
  }, [resetToken]);

  // The trail means different things in 1D (x,p) and 2D (x,y) — start it afresh.
  useEffect(() => {
    oscPort.clearTrail = true;
    wigAccum.current = 1e9;
  }, [twoD, coherent]);

  /* ------------------------------- geometry -------------------------------- */
  const geometry = useCallback((): Geo => {
    const { w, h, dpr } = sizeRef.current;
    const st = useSimStore.getState();
    const p = st.params[slug] ?? {};
    const wide = st.inspectorOpen && w > 900;
    const ladder = pBool(p, 'showLadder', true);
    const phase = pBool(p, 'showPhaseSpace', true) && dimOf(p) !== 2;
    const dockH = ladder || phase ? 146 : 0;
    const left = 14;
    const right = w - (wide ? 348 : 16);
    const top = 62;
    const bottom = Math.max(top + 110, h - 54 - dockH);
    return { w, h, dpr, left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
  }, [slug]);

  const resize = useCallback(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(240, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));
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

  /** Lazily sized offscreen bitmap, reused across frames. */
  const offscreen = useCallback((size: number): Off | null => {
    let slot = offRef.current;
    if (!slot || slot.size !== size) {
      if (typeof document === 'undefined') return null;
      const cv = document.createElement('canvas');
      cv.width = size;
      cv.height = size;
      const ctx = cv.getContext('2d');
      if (!ctx) return null;
      slot = { cv, ctx, img: ctx.createImageData(size, size), size };
      offRef.current = slot;
    }
    return slot;
  }, []);

  /* --------------------------------- 1D ------------------------------------ */
  const draw1D = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, p: SimParams, view: ReturnType<typeof oscView>) => {
      const omega = clamp(pNum(p, 'omega', 1), 0.05, 8);
      const xMax = clamp(pNum(p, 'xMax', 7), 1.5, 16);
      const exposure = clamp(pNum(p, 'contrast', 1), 0.05, 4);
      const t = oscPort.t;
      const c = stateCoeffs(p);
      const ev = propagate(c, omega, t);
      const live: Coeffs = { ...c, re: ev.re, im: ev.im };
      const m = moments(live, omega);
      const gridN = Math.round(clamp(pNum(p, 'gridN', 512), 64, 2048));
      const field = evaluateWave(c.ns, ev.re, ev.im, omega, gridN, xMax);
      const A = turningAmplitude(m.energy, omega);

      oscPort.x = m.x;
      oscPort.p = m.p;
      pushTrail(m.x, m.p);

      const fw = g.right - g.left;
      const fh = g.bottom - g.top;
      const xToPx = (x: number) => g.left + ((x + xMax) / (2 * xMax)) * fw;
      const eMax = Math.max(potential(xMax, omega) * 1.12, m.energy * 1.4, 1.2);
      const eToPx = (e: number) => g.bottom - clamp(e / eMax, 0, 1.02) * fh;
      const baseY = eToPx(m.energy);

      // ── x axis ───────────────────────────────────────────────────────────
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.left, g.bottom);
      ctx.lineTo(g.right, g.bottom);
      ctx.stroke();
      ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(107,125,153,0.85)';
      const tick = xMax > 9 ? 2 : 1;
      for (let x = -Math.floor(xMax / tick) * tick; x <= xMax; x += tick) {
        const px = xToPx(x);
        ctx.beginPath();
        ctx.moveTo(px, g.bottom);
        ctx.lineTo(px, g.bottom + 4);
        ctx.stroke();
        ctx.fillText(`${x}`, px, g.bottom + 14);
      }
      ctx.textAlign = 'left';
      ctx.fillText('x / ℓ', g.right - 28, g.bottom + 14);
      ctx.restore();

      // ── classically forbidden band |x| > A ───────────────────────────────
      if (pBool(p, 'showEnvelope', true) && A < xMax) {
        ctx.save();
        ctx.fillStyle = 'rgba(251,113,133,0.06)';
        ctx.fillRect(g.left, g.top, Math.max(0, xToPx(-A) - g.left), fh);
        ctx.fillRect(xToPx(A), g.top, Math.max(0, g.right - xToPx(A)), fh);
        ctx.restore();
      }

      // ── ħω gridlines, then the potential ─────────────────────────────────
      ctx.save();
      ctx.font = '8.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'left';
      const rungStep = eMax > 22 ? 5 : eMax > 11 ? 2 : 1;
      for (let e = rungStep; e < eMax; e += rungStep) {
        const y = eToPx(e);
        ctx.strokeStyle = 'rgba(148,163,184,0.10)';
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(g.left, y);
        ctx.lineTo(g.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(107,125,153,0.55)';
        ctx.fillText(`${e}`, g.left + 2, y - 2);
      }
      ctx.strokeStyle = 'rgba(52,211,153,0.5)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const vSteps = 180;
      for (let i = 0; i <= vSteps; i++) {
        const x = -xMax + (2 * xMax * i) / vSteps;
        const px = xToPx(x);
        const py = eToPx(potential(x, omega));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(52,211,153,0.75)';
      ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(
        'V(x) = ½ω²x²',
        g.right - 4,
        clamp(eToPx(potential(xMax, omega)) + 13, g.top + 12, g.bottom - 6),
      );
      ctx.restore();

      // ── ⟨E⟩ baseline ─────────────────────────────────────────────────────
      ctx.save();
      ctx.strokeStyle = coherent ? 'rgba(129,140,248,0.85)' : 'rgba(251,191,36,0.7)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(g.left, baseY);
      ctx.lineTo(g.right, baseY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = coherent ? 'rgba(129,140,248,0.95)' : 'rgba(251,191,36,0.9)';
      ctx.fillText(`⟨E⟩ = ${m.units.toFixed(2)} ħω`, g.left + 4, baseY - 4);
      ctx.restore();

      // One shared density scale for |ψ|² and P_cl, stated numerically in the HUD.
      const classicalPeak = A > 0 ? classicalDensity(A * 0.985, A) : 0;
      const shown = Math.max(field.peak, pBool(p, 'showClassical', true) ? Math.min(classicalPeak, field.peak * 4) : 0, 1e-6);
      const ampPx = fh * 0.34;
      const dToPx = (d: number) => (d / shown) * ampPx;
      const psiScale = Math.sqrt(field.peak) || 1;
      // counted while the nodal ticks are drawn, reported in the HUD
      let zeroCrossings = 0;

      ctx.save();
      ctx.beginPath();
      ctx.rect(g.left, g.top - 6, fw, fh + 12);
      ctx.clip();

      // ── phase ribbon ─────────────────────────────────────────────────────
      if (view === 'phase') {
        const bandH = Math.max(16, fh * 0.17);
        const y0 = g.bottom - bandH - 10;
        for (let i = 0; i < field.count; i++) {
          const d = field.density[i];
          if (d < 1e-7) continue;
          const ang = Math.atan2(field.im[i], field.re[i]);
          const u = (ang / TAU + 0.5) % 1;
          const bin = Math.floor((u < 0 ? u + 1 : u) * HUE) % HUE;
          const l = clamp(Math.pow(Math.min(1, (d / field.peak) * exposure), 1 / 1.9), 0, 1);
          const x = -xMax + i * field.dx;
          const px = xToPx(x);
          const nx = xToPx(x + field.dx);
          ctx.fillStyle = `rgb(${Math.round((BG.r + (lut[bin * 3] - BG.r) * l) * 255)},${Math.round(
            (BG.g + (lut[bin * 3 + 1] - BG.g) * l) * 255,
          )},${Math.round((BG.b + (lut[bin * 3 + 2] - BG.b) * l) * 255)})`;
          ctx.fillRect(px, y0, Math.max(1, nx - px + 0.7), bandH);
        }
        ctx.strokeStyle = 'rgba(148,163,184,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(g.left, y0, fw, bandH);
        ctx.fillStyle = 'rgba(159,176,204,0.8)';
        ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('arg ψ → hue · brightness → |ψ|²', g.left, y0 - 6);
      }

      // ── |ψ|² ─────────────────────────────────────────────────────────────
      if (view === 'density' || view === 'phase') {
        ctx.beginPath();
        ctx.moveTo(xToPx(-xMax), baseY);
        for (let i = 0; i < field.count; i++) ctx.lineTo(xToPx(-xMax + i * field.dx), baseY - dToPx(field.density[i]));
        ctx.lineTo(xToPx(xMax), baseY);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, baseY - ampPx, 0, baseY);
        grad.addColorStop(0, 'rgba(52,211,153,0.40)');
        grad.addColorStop(1, 'rgba(52,211,153,0.05)');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(110,231,183,0.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < field.count; i++) {
          const px = xToPx(-xMax + i * field.dx);
          const py = baseY - dToPx(field.density[i]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // zeros of the instantaneous Re ψ = the nodal pattern
        ctx.fillStyle = 'rgba(232,238,252,0.8)';
        for (let i = 1; i < field.count; i++) {
          if (field.re[i - 1] * field.re[i] <= 0 && Math.abs(field.re[i] - field.re[i - 1]) > 1e-9) {
            zeroCrossings++;
            const px = xToPx(-xMax + (i - 0.5) * field.dx);
            ctx.beginPath();
            ctx.arc(px, baseY - dToPx(field.density[i]) + 3, 1.7, 0, TAU);
            ctx.fill();
          }
        }
      }

      // ── Re ψ / Im ψ ──────────────────────────────────────────────────────
      if (view === 'reim') {
        const stroke = (arr: Float64Array, thin: boolean) => {
          ctx.beginPath();
          for (let i = 0; i < field.count; i++) {
            const px = xToPx(-xMax + i * field.dx);
            const py = baseY - (arr[i] / psiScale) * ampPx;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.lineWidth = thin ? 1.1 : 2;
          ctx.strokeStyle = thin ? 'rgba(129,140,248,0.9)' : 'rgba(110,231,183,0.98)';
          ctx.stroke();
        };
        stroke(field.re, false);
        stroke(field.im, true);
        ctx.strokeStyle = 'rgba(148,163,184,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.left, baseY);
        ctx.lineTo(g.right, baseY);
        ctx.stroke();
      }

      // ── classical density on the same scale ──────────────────────────────
      if (view !== 'reim' && pBool(p, 'showClassical', true) && A > 0) {
        ctx.save();
        ctx.setLineDash([5, 3]);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = 'rgba(251,191,36,0.95)';
        ctx.beginPath();
        let started = false;
        const inner = A * 0.9985;
        const steps = 480;
        for (let i = 0; i <= steps; i++) {
          const x = -inner + (2 * inner * i) / steps;
          const d = classicalDensity(x, A);
          if (!Number.isFinite(d) || d > shown * 3) {
            started = false;
            continue;
          }
          const px = xToPx(x);
          const py = baseY - dToPx(d);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }

      // ── turning points ───────────────────────────────────────────────────
      if (pBool(p, 'showTurningPoints', true) && A < xMax) {
        ctx.save();
        ctx.strokeStyle = 'rgba(251,113,133,0.75)';
        ctx.fillStyle = 'rgba(251,113,133,0.95)';
        ctx.lineWidth = 1.3;
        ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
        for (const s of [-1, 1]) {
          const px = xToPx(s * A);
          ctx.beginPath();
          ctx.moveTo(px, baseY - 7);
          ctx.lineTo(px, baseY + 7);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, baseY, 2.6, 0, TAU);
          ctx.fill();
          ctx.textAlign = s < 0 ? 'left' : 'right';
          ctx.fillText(`${s < 0 ? '−' : '+'}A = ${(s * A).toFixed(2)}`, px + s * 6, baseY + 20);
        }
        ctx.restore();
      }

      // ── packet centre ────────────────────────────────────────────────────
      const cxp = xToPx(clamp(m.x, -xMax, xMax));
      ctx.save();
      ctx.strokeStyle = 'rgba(232,238,252,0.7)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cxp, baseY - ampPx - 10);
      ctx.lineTo(cxp, baseY + 8);
      ctx.stroke();
      ctx.fillStyle = 'rgba(232,238,252,0.95)';
      ctx.beginPath();
      ctx.arc(cxp, baseY, 3.2, 0, TAU);
      ctx.fill();
      ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`⟨x⟩ = ${m.x.toFixed(3)}`, cxp, baseY - ampPx - 15);
      ctx.restore();
      ctx.restore(); // clip

      // ── HUD ──────────────────────────────────────────────────────────────
      ctx.save();
      ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(159,176,204,0.8)';
      ctx.fillText(
        `⟨n⟩ = ${m.nbar.toFixed(3)} · ΔxΔp = ${m.product.toFixed(4)} ħ · ⟨p⟩ = ${m.p.toFixed(3)} · t = ${((t * omega) / TAU).toFixed(2)} T`,
        g.right,
        g.top - 10,
      );
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(107,125,153,0.9)';
      ctx.fillText(
        view === 'reim'
          ? `solid Re ψ, thin Im ψ about the ⟨E⟩ line · density scale ${shown.toFixed(3)} ℓ⁻¹ ↔ ${ampPx.toFixed(0)} px · ${gridN} samples`
          : `|ψ|² and P_cl share one scale: ${shown.toFixed(3)} ℓ⁻¹ ↔ ${ampPx.toFixed(0)} px · energy ${eMax.toFixed(1)} ħω ↔ ${fh.toFixed(0)} px · ${gridN} samples · ${zeroCrossings} zeros of Re ψ on screen`,
        g.left,
        g.bottom + 28,
      );
      ctx.restore();
    },
    [coherent, lut],
  );

  /* --------------------------------- Wigner -------------------------------- */
  const drawWigner = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, p: SimParams, dt: number) => {
      const omega = clamp(pNum(p, 'omega', 1), 0.05, 8);
      const xMax = clamp(pNum(p, 'xMax', 7), 1.5, 16);
      const exposure = clamp(pNum(p, 'contrast', 1), 0.05, 4);
      const t = oscPort.t;
      const c = stateCoeffs(p);
      const ev = propagate(c, omega, t);
      const live: Coeffs = { ...c, re: ev.re, im: ev.im };
      const m = moments(live, omega);
      oscPort.x = m.x;
      oscPort.p = m.p;
      pushTrail(m.x, m.p);

      const cached = planRef.current;
      if (!cached || Math.abs(cached.omega - omega) > 1e-6 || Math.abs(cached.xMax - xMax) > 1e-6) {
        planRef.current = { plan: wignerPlan(WIG, WIG_Y, omega, xMax), omega, xMax };
        wigAccum.current = 1e9;
      }
      const plan = planRef.current!.plan;

      // A stationary state has a stationary Wigner picture — refresh it lazily.
      const superposed = c.ns.length > 1;
      wigAccum.current += dt;
      if (wigAccum.current > (superposed || Math.abs(m.absA) > 1e-9 ? 1 / 45 : 1 / 10)) {
        wigAccum.current = 0;
        const slot = offscreen(WIG);
        if (slot) {
          const grid = evaluateWave(c.ns, ev.re, ev.im, omega, WIG * 12, xMax);
          const w = wignerEvaluate(plan, grid);
          wigMax.current = w.max;
          const n = WIG;
          const data = slot.img.data;
          const inv = w.max > 0 ? 1 / w.max : 0;
          for (let j = 0; j < n; j++) {
            const src = n - 1 - j;
            for (let i = 0; i < n; i++) {
              const v = w.values[src * n + i] * inv;
              const a = clamp(Math.pow(Math.abs(v) * exposure * 1.2, 1 / 1.7), 0, 1);
              const base = v >= 0 ? ACCENT : NEGATIVE;
              const o = (j * n + i) * 4;
              data[o] = Math.round((BG.r + (base.r - BG.r) * a) * 255);
              data[o + 1] = Math.round((BG.g + (base.g - BG.g) * a) * 255);
              data[o + 2] = Math.round((BG.b + (base.b - BG.b) * a) * 255);
              data[o + 3] = 255;
            }
          }
          slot.ctx.putImageData(slot.img, 0, 0);
          wigRef.current = slot.cv;
        }
      }
      const src = wigRef.current;
      if (!src) return;

      const fw = g.right - g.left;
      const fh = g.bottom - g.top;
      const span = plan.xs[WIG - 1];
      const pSpan = plan.ps[WIG - 1];
      const xToPx = (x: number) => g.left + ((x + span) / (2 * span)) * fw;
      const pToPx = (q: number) => g.bottom - ((q + pSpan) / (2 * pSpan)) * fh;

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(src, g.left, g.top, fw, fh);
      ctx.strokeStyle = 'rgba(148,163,184,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(g.left, g.top, fw, fh);

      // classical energy shell p²/2 + ω²x²/2 = E
      const E = m.energy;
      const Ax = turningAmplitude(E, omega);
      const Ap = Math.sqrt(Math.max(0, 2 * E));
      if (Ax <= span && Ap <= pSpan) {
        ctx.strokeStyle = 'rgba(251,191,36,0.85)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i <= 180; i++) {
          const th = (i / 180) * TAU;
          const px = xToPx(Ax * Math.cos(th));
          const py = pToPx(-Ap * Math.sin(th));
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // live (⟨x⟩,⟨p⟩) and the trail it has swept out
      ctx.strokeStyle = 'rgba(232,238,252,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const n = oscPort.trailN;
      for (let i = 0; i < n; i++) {
        const k = (oscPort.trailHead - n + i + TRAIL * 2) % TRAIL;
        const px = xToPx(clamp(oscPort.trailX[k], -span, span));
        const py = pToPx(clamp(oscPort.trailY[k], -pSpan, pSpan));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(232,238,252,0.95)';
      ctx.beginPath();
      ctx.arc(xToPx(clamp(m.x, -span, span)), pToPx(clamp(m.p, -pSpan, pSpan)), 3.4, 0, TAU);
      ctx.fill();

      ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(159,176,204,0.85)';
      ctx.textAlign = 'left';
      ctx.fillText(`+${pSpan.toFixed(1)}`, g.left + 4, g.top + 12);
      ctx.textAlign = 'right';
      ctx.fillText(`+${span.toFixed(1)}`, g.right - 4, g.bottom - 5);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(52,211,153,0.9)';
      ctx.fillText(`W > 0 green · W < 0 rose · peak ${(wigMax.current * (Math.PI / 2)).toFixed(2)}`, g.cx, g.top - 10);
      ctx.fillStyle = 'rgba(251,191,36,0.9)';
      ctx.textAlign = 'right';
      ctx.fillText(`classical shell E = ${E.toFixed(2)} ħω`, g.right, g.top - 22);
      ctx.restore();

      ctx.save();
      ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(107,125,153,0.9)';
      ctx.fillText(
        `W(x,p) = (1/π)∫dy Re[ψ*(x+y)ψ(x−y)e^{2ipy}] on ${WIG}×${WIG}, ${WIG_Y}-point y-integral · x ∈ ±${span.toFixed(2)} ℓ · p ∈ ±${pSpan.toFixed(2)}`,
        g.left,
        g.bottom + 28,
      );
      ctx.restore();
    },
    [offscreen],
  );

  /* ---------------------------------- 2D ----------------------------------- */
  const draw2D = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, p: SimParams, view: ReturnType<typeof oscView>) => {
      const omega = clamp(pNum(p, 'omega', 1), 0.05, 8);
      const xMax = clamp(pNum(p, 'xMax', 7), 1.5, 16);
      const exposure = clamp(pNum(p, 'contrast', 1), 0.05, 4);
      const t = oscPort.t;
      const s = state2D(p, t, FIELD_2D);
      const field = compose2D(s.branches, xMax, FIELD_2D);
      const n = field.size;

      oscPort.x = s.cx;
      oscPort.y = s.cy;
      oscPort.p = s.cpx;
      oscPort.py = s.cpy;
      pushTrail(s.cx, s.cy);

      const side = Math.max(120, Math.min(g.right - g.left, g.bottom - g.top) - 10);
      const ox = g.cx - side / 2;
      const oy = g.cy - side / 2;
      const xToPx = (x: number) => ox + ((x + xMax) / (2 * xMax)) * side;
      const yToPx = (y: number) => oy + ((xMax - y) / (2 * xMax)) * side;

      const slot = offscreen(n);
      if (slot) {
        const data = slot.img.data;
        const useHue = pBool(p, 'phaseColor', true);
        for (let j = 0; j < n; j++) {
          const src = n - 1 - j;
          for (let i = 0; i < n; i++) {
            const o = src * n + i;
            const d = field.density[o];
            const l = clamp(Math.pow(Math.min(1, d * exposure), 1 / 2.1), 0, 1);
            let r = ACCENT.r;
            let gg = ACCENT.g;
            let bb = ACCENT.b;
            if (useHue) {
              let u = (field.phase[o] / TAU + 0.5) % 1;
              if (u < 0) u += 1;
              const bin = Math.floor(u * HUE) % HUE;
              r = lut[bin * 3];
              gg = lut[bin * 3 + 1];
              bb = lut[bin * 3 + 2];
            }
            const k = (j * n + i) * 4;
            data[k] = Math.round((BG.r + (r - BG.r) * l) * 255);
            data[k + 1] = Math.round((BG.g + (gg - BG.g) * l) * 255);
            data[k + 2] = Math.round((BG.b + (bb - BG.b) * l) * 255);
            data[k + 3] = 255;
          }
        }
        slot.ctx.putImageData(slot.img, 0, 0);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(slot.cv, ox, oy, side, side);
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox, oy, side, side);
      ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(107,125,153,0.85)';
      ctx.textAlign = 'center';
      ctx.fillText(`x → ±${xMax.toFixed(2)} ℓ`, ox + side / 2, oy + side + 14);
      ctx.save();
      ctx.translate(ox - 8, oy + side / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('y →', 0, 0);
      ctx.restore();

      // classical shell V = ⟨E⟩
      const A2 = turningAmplitude(s.energy, omega);
      if (A2 < xMax * 1.4) {
        ctx.strokeStyle = 'rgba(251,191,36,0.7)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(xToPx(0), yToPx(0), Math.abs(xToPx(A2) - xToPx(0)), 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(251,191,36,0.9)';
        ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`V = ⟨E⟩: r = ${A2.toFixed(2)}`, xToPx(0) + 5, yToPx(0) - Math.abs(xToPx(A2) - xToPx(0)) - 5);
      }

      if (view === 'wiggle') {
        const step = Math.max(4, Math.floor(n / 26));
        let sum = 0;
        ctx.save();
        ctx.lineCap = 'round';
        for (let j = step; j < n - step; j += step) {
          for (let i = step; i < n - step; i += step) {
            if (field.density[j * n + i] < 0.004) continue;
            const [jx, jy] = current2D(field, i, j);
            const mag = Math.hypot(jx, jy);
            sum += mag;
            const x = xToPx(-xMax + (2 * xMax * i) / (n - 1));
            const y = yToPx(-xMax + (2 * xMax * j) / (n - 1));
            if (mag < 1e-4) {
              ctx.fillStyle = 'rgba(148,163,184,0.4)';
              ctx.beginPath();
              ctx.arc(x, y, 1.2, 0, TAU);
              ctx.fill();
              continue;
            }
            const len = clamp(mag * 110, 3, 15);
            const ux = jx / mag;
            const uy = -jy / mag;
            ctx.strokeStyle = `rgba(129,140,248,${clamp(0.2 + mag * 4, 0.2, 0.95).toFixed(3)})`;
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(x - ux * len * 0.5, y - uy * len * 0.5);
            ctx.lineTo(x + ux * len * 0.5, y + uy * len * 0.5);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x + ux * len * 0.5, y + uy * len * 0.5);
            ctx.lineTo(x + ux * len * 0.5 - ux * 3.2 - uy * 2.1, y + uy * len * 0.5 - uy * 3.2 + ux * 2.1);
            ctx.stroke();
          }
        }
        ctx.restore();
        ctx.font = '10.5px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = 'rgba(159,176,204,0.9)';
        ctx.textAlign = 'left';
        ctx.fillText(
          sum < 1e-3
            ? 'J = Im(Ψ*∇Ψ) ≡ 0 — a real stationary combination carries no current, only nodal lines'
            : `J = Im(Ψ*∇Ψ), Σ|J| = ${sum.toFixed(2)} — circulation without dissipation`,
          ox,
          oy - 8,
        );
      }

      if (s.coherent) {
        const R = Math.sqrt(2 / omega) * Math.hypot(pNum(p, 'alphaRe', 1.6), pNum(p, 'alphaIm', 0));
        if (R > 1e-3 && R < xMax * 1.6) {
          ctx.strokeStyle = 'rgba(129,140,248,0.55)';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(xToPx(0), yToPx(0), Math.abs(xToPx(R) - xToPx(0)), 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      const px0 = xToPx(clamp(s.cx, -xMax, xMax));
      const py0 = yToPx(clamp(s.cy, -xMax, xMax));
      ctx.strokeStyle = 'rgba(232,238,252,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px0 - 7, py0);
      ctx.lineTo(px0 + 7, py0);
      ctx.moveTo(px0, py0 - 7);
      ctx.lineTo(px0, py0 + 7);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(159,176,204,0.8)';
      ctx.fillText(
        `⟨E⟩ = ${(s.energy / omega).toFixed(3)} ħω · centre (${s.cx.toFixed(2)}, ${s.cy.toFixed(2)}) ℓ · t = ${((t * omega) / TAU).toFixed(2)} T`,
        g.right,
        g.top - 10,
      );
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(107,125,153,0.9)';
      ctx.fillText(
        s.coherent
          ? `|αₓ⟩ ⊗ |α_y⟩ with α_y = −iαₓ · ${n}×${n} offscreen heatmap · hue = arg Ψ, brightness = |Ψ|² · drag the stage to place the packet`
          : `cos θ|${Math.round(pNum(p, 'nx2', 0))},${Math.round(pNum(p, 'ny2', 0))}⟩ + sin θ|${Math.round(
            pNum(p, 'ny2', 0),
          )},${Math.round(pNum(p, 'nx2', 0))}⟩ · degenerate pair, so the pattern is stationary · hue = sign Ψ`,
        g.left,
        g.bottom + 28,
      );
      ctx.restore();
    },
    [lut, offscreen],
  );

  /* --------------------------------- clock --------------------------------- */
  useAnimationClock(({ dt, elapsed }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const st = useSimStore.getState();
    const p = st.params[slug] ?? {};
    const g = geometry();
    if (g.w < 200) return;

    oscPort.elapsed = elapsed;
    if (pBool(p, 'animate', true)) oscPort.t += dt;

    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    const bg = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, Math.max(g.w, g.h) * 0.8);
    bg.addColorStop(0, 'rgba(52,211,153,0.07)');
    bg.addColorStop(0.6, 'rgba(10,14,23,0)');
    bg.addColorStop(1, 'rgba(3,5,10,0.6)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, g.w, g.h);

    const view = oscView(p);
    if (dimOf(p) === 2) draw2D(ctx, g, p, view);
    else if (view === 'wiggle') drawWigner(ctx, g, p, dt);
    else draw1D(ctx, g, p, view);
  });

  /* --------------------------------- drag ---------------------------------- */
  const onPointer = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>, kind: 'down' | 'move' | 'up') => {
      if (kind === 'up') {
        dragRef.current = false;
        return;
      }
      if (kind === 'down') {
        dragRef.current = true;
        ev.currentTarget.setPointerCapture?.(ev.pointerId);
        interruptDemo();
        oscPort.clearTrail = true;
      }
      if (!dragRef.current) return;
      const st = useSimStore.getState();
      const p = st.params[slug] ?? {};
      if (!pBool(p, 'coherent', false)) return;
      const g = geometry();
      const omega = clamp(pNum(p, 'omega', 1), 0.05, 8);
      const xMax = clamp(pNum(p, 'xMax', 7), 1.5, 16);
      const rect = ev.currentTarget.getBoundingClientRect();
      const fx = ((ev.clientX - rect.left - g.left) / Math.max(1, g.right - g.left)) * 2 * xMax - xMax;
      const fy = ((ev.clientY - rect.top - g.top) / Math.max(1, g.bottom - g.top)) * 2 * xMax - xMax;
      const scale = Math.sqrt(omega / 2);
      const patch: SimParams = { alphaRe: Math.round(clamp(fx * scale, -4, 4) * 1000) / 1000 };
      if (dimOf(p) === 2) patch.alphaIm = Math.round(clamp(-fy * scale, -4, 4) * 1000) / 1000;
      setParams(slug, patch);
    },
    [geometry, interruptDemo, setParams, slug],
  );

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden bg-obsidian"
      onPointerDown={(e) => onPointer(e, 'down')}
      onPointerMove={(e) => onPointer(e, 'move')}
      onPointerUp={(e) => onPointer(e, 'up')}
      onPointerCancel={(e) => onPointer(e, 'up')}
      style={{ touchAction: 'none' }}
      role="application"
      aria-label="Quantum harmonic oscillator: eigenstates, coherent states and the classical limit"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block" />
      {dockOn ? <Dock slug={slug} /> : null}
    </div>
  );
}
