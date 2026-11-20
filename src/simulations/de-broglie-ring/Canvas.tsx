'use client';

/**
 * de Broglie Ring — stage viewport.
 *
 * Everything is drawn imperatively on a single 2D canvas from the shared rAF
 * clock: React only owns the mount, the tab switch and the drag handlers. The
 * wave is evaluated analytically at every sample —
 *     ψ(θ,t) = e^{−iϖ(t)}[e^{inθ} + Q·e^{−inθ}]
 * so Re ψ becomes a radial displacement, arg ψ a hue on the shared twilight
 * wheel and |ψ| the brightness, and the same Q that colours the ring is the
 * round-trip buildup drawn as the phasor braid inside the orbit.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { BOHR_RADIUS_M } from '@/engine/physics/constants';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { densityPhaseColor, phaseColor, rgbCss } from '@/lib/colorMap';
import { pBool, pNum, pStr, useSimStore } from '@/store/useSimStore';
import type { SimParams, SimSlug } from '@/simulations/types';
import { ScalePanel } from './ScalePanel';
import {
  buildup,
  lockWinding,
  pixelsToRadius,
  radiusToPixels,
  ringState,
  presetById,
} from './physics';

const TAU = Math.PI * 2;
/** Carrier oscillation rate of the standing wave, rad/s (purely cosmetic). */
const CARRIER = 1.65;
/** Circuits drawn in the buildup braid. */
const BRAID = 16;
const HUE_BINS = 44;

export default function DeBroglieCanvas({ slug }: { slug: SimSlug }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);
  const sweepRef = useRef(0);
  const flashRef = useRef(0);
  const braidRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const lastNRef = useRef(NaN);
  const lastWriteRef = useRef(0);
  const lastChoiceRef = useRef('');
  const wasResonantRef = useRef(false);
  const dragRef = useRef(false);
  const bufRef = useRef<{ re: Float32Array; mag: Float32Array; ang: Float32Array }>({
    re: new Float32Array(2401),
    mag: new Float32Array(2401),
    ang: new Float32Array(2401),
  });

  const setParam = useSimStore((s) => s.setParam);
  const setParams = useSimStore((s) => s.setParams);
  const interruptDemo = useSimStore((s) => s.interruptDemo);
  const params = useSimStore((s) => s.params[slug]);
  const palette = useSimStore((s) => s.prefs.palette);
  const scaleMode = pStr(params, 'tab', 'orbit') === 'scale';

  /* --- keep the canonical SI beam numbers locked to their log sliders -------- */
  useEffect(() => {
    const lm = pNum(params, 'logMass', -30.0405);
    const ls = pNum(params, 'logSpeed', 6);
    const la = pNum(params, 'logSlit', 0);
    const want: [string, number][] = [
      ['massKg', Math.pow(10, lm)],
      ['speedMS', Math.pow(10, ls)],
      ['slitNm', Math.pow(10, la)],
    ];
    const patch: SimParams = {};
    for (const [key, value] of want) {
      const have = Number(params[key]);
      if (!Number.isFinite(have) || have <= 0 || Math.abs(have / value - 1) > 1e-3) patch[key] = value;
    }
    if (Object.keys(patch).length) setParams(slug, patch);
  }, [params, setParams, slug]);

  /* --- a beam preset carries its real mass and velocity --------------------- */
  useEffect(() => {
    const choice = pStr(params, 'massChoice', 'custom');
    if (choice === lastChoiceRef.current) return;
    lastChoiceRef.current = choice;
    const preset = presetById(choice);
    if (!preset) return;
    setParams(slug, {
      massKg: preset.massKg,
      speedMS: preset.speedMS,
      logMass: Math.log10(preset.massKg),
      logSpeed: Math.log10(preset.speedMS),
    });
  }, [params, setParams, slug]);

  const geometry = useCallback(() => {
    const { w, h } = sizeRef.current;
    const inspector = useSimStore.getState().inspectorOpen && typeof window !== 'undefined' && w > 720;
    const left = 14;
    const right = w - (inspector ? 348 : 16);
    const top = 72;
    const bottom = h - 52;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const fit = Math.max(60, Math.min(right - left, bottom - top) / 2 - 10);
    return { cx, cy, fit, left, right, top, bottom, w, h };
  }, []);

  const resize = useCallback(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const rect = host.getBoundingClientRect();
    const resScale = pNum(useSimStore.getState().params[slug] ?? {}, 'resScale', 1);
    const dpr = Math.min(2, (window.devicePixelRatio || 1) * (Number.isFinite(resScale) ? resScale : 1));
    const w = Math.max(240, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));
    sizeRef.current = { w, h, dpr };
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
  }, [slug]);

  useEffect(() => {
    resize();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(host);
    return () => ro.disconnect();
  }, [resize]);

  /* --------------------------------- render -------------------------------- */
  const drawOrbit = useCallback(
    (ctx: CanvasRenderingContext2D, dt: number, elapsed: number) => {
      const state = useSimStore.getState();
      const p = state.params[slug] ?? {};
      const { w, h, dpr } = sizeRef.current;
      const geo = geometry();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // ── background field ────────────────────────────────────────────────
      const bg = ctx.createRadialGradient(geo.cx, geo.cy, 0, geo.cx, geo.cy, Math.max(w, h) * 0.75);
      bg.addColorStop(0, 'rgba(129,140,248,0.10)');
      bg.addColorStop(0.55, 'rgba(10,14,23,0.0)');
      bg.addColorStop(1, 'rgba(3,5,10,0.55)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const sweepOn = pBool(p, 'sweep', false);
      const lockWidth = Math.max(0, pNum(p, 'lockWidth', 0.08));
      const base = ringState(p);

      // ── the n sweep: a continuous triangle ramp across integers 1…8 ──────
      let nRaw = base.nRaw;
      if (sweepOn) {
        const rate = Math.max(0.02, pNum(p, 'sweepSpeed', 0.25));
        sweepRef.current += dt * rate;
        const period = 14; // n traverses 1 → 8 → 1
        const u = (sweepRef.current % period) / period;
        const tri = u < 0.5 ? u * 2 : 2 - u * 2;
        nRaw = 1 + tri * 7;
      }
      const n = sweepOn ? lockWinding(nRaw, lockWidth) : base.n;
      const quality = buildup(n);
      const nInt = Math.round(n);
      const residual = n - nInt;

      // Publish the live winding number for the telemetry pill (≈15 Hz).
      if (sweepOn && (elapsed - lastWriteRef.current > 0.066 || !Number.isFinite(lastNRef.current))) {
        if (!Number.isFinite(lastNRef.current) || Math.abs(n - lastNRef.current) > 0.002) {
          lastWriteRef.current = elapsed;
          lastNRef.current = n;
          setParam(slug, 'nDisplay', Math.round(n * 1000) / 1000);
        }
      }
      if (!sweepOn) lastNRef.current = NaN;

      const lamAU = TAU * base.rAU / nRaw;
      const showWave = pBool(p, 'showWave', true);
      const showStanding = pBool(p, 'showStanding', true);
      const showInterference = pBool(p, 'showInterference', true);
      const showGuides = pBool(p, 'showGuides', true);
      const amplitude = pNum(p, 'amplitude', 1);
      const thickness = pNum(p, 'thickness', 2.2);
      const phi0 = pNum(p, 'spinPhase', 0);

      // ── resonance flash on lock acquisition ──────────────────────────────
      const resonant = quality > 0.985;
      if (resonant && !wasResonantRef.current) flashRef.current = 1;
      wasResonantRef.current = resonant;
      flashRef.current = Math.max(0, flashRef.current - dt * 1.7);
      const flash = flashRef.current + (resonant ? 0.22 : 0);

      const rPx = radiusToPixels(base.rAU, geo.fit);
      const ampPx = Math.max(6, rPx * 0.16) * amplitude;

      // ── Bohr-allowed radii rₙ = nλ/2π ────────────────────────────────────
      if (showGuides) {
        ctx.save();
        ctx.setLineDash([2, 5]);
        ctx.lineWidth = 1;
        for (let k = 1; k <= 8; k++) {
          const rk = (k * lamAU) / TAU;
          if (rk < 0.5 || rk > 20) continue;
          const px = radiusToPixels(rk, geo.fit);
          const near = Math.abs(px - rPx) < 2.5;
          ctx.strokeStyle = near ? 'rgba(94,234,212,0.55)' : 'rgba(148,163,184,0.20)';
          ctx.beginPath();
          ctx.arc(geo.cx, geo.cy, px, 0, TAU);
          ctx.stroke();
          if (px < geo.fit - 6) {
            ctx.setLineDash([]);
            ctx.fillStyle = near ? 'rgba(94,234,212,0.85)' : 'rgba(148,163,184,0.42)';
            ctx.font = '9px "JetBrains Mono", ui-monospace, monospace';
            ctx.fillText(`${k}`, geo.cx + 3.5, geo.cy - px - 3);
            ctx.setLineDash([2, 5]);
          }
        }
        ctx.restore();
      }

      // ── bare orbit circle + nucleus ──────────────────────────────────────
      ctx.strokeStyle = 'rgba(148,163,184,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(geo.cx, geo.cy, rPx, 0, TAU);
      ctx.stroke();

      const nucleus = ctx.createRadialGradient(geo.cx, geo.cy, 0, geo.cx, geo.cy, 16);
      nucleus.addColorStop(0, 'rgba(232,238,252,0.95)');
      nucleus.addColorStop(0.45, 'rgba(129,140,248,0.55)');
      nucleus.addColorStop(1, 'rgba(129,140,248,0)');
      ctx.fillStyle = nucleus;
      ctx.beginPath();
      ctx.arc(geo.cx, geo.cy, 16, 0, TAU);
      ctx.fill();

      // ── the wave itself ──────────────────────────────────────────────────
      phaseRef.current = (phaseRef.current + dt * CARRIER) % TAU;
      const rho = showStanding ? quality : 0;
      const norm = 1 + rho;
      const cosP = Math.cos(phaseRef.current);
      const sinP = Math.sin(phaseRef.current);
      const samples = Math.max(240, Math.min(2400, Math.round(rPx * 5 + Math.abs(n) * 26)));
      const dTheta = TAU / samples;

      const buf = bufRef.current;
      const reArr = buf.re.length > samples ? buf.re : new Float32Array(samples + 1);
      const magArr = reArr === buf.re ? buf.mag : new Float32Array(samples + 1);
      const angArr = reArr === buf.re ? buf.ang : new Float32Array(samples + 1);
      for (let i = 0; i <= samples; i++) {
        const th = i * dTheta;
        const a = n * th - phi0;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const reU = norm * ca;
        const imU = (1 - rho) * sa;
        const re = reU * cosP + imU * sinP;
        const im = imU * cosP - reU * sinP;
        reArr[i] = re / norm;
        magArr[i] = Math.hypot(re, im) / norm;
        angArr[i] = Math.atan2(im, re);
      }

      const pointAt = (i: number): [number, number] => {
        const th = i * dTheta;
        const rr = rPx + ampPx * reArr[i];
        return [geo.cx + Math.cos(th) * rr, geo.cy - Math.sin(th) * rr];
      };

      // |ψ|² petal — the probability envelope, drawn as a soft filled ring.
      if (showStanding && rho > 0.02) {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
          const th = i * dTheta;
          const rr = rPx + ampPx * 1.5 * magArr[i] * magArr[i];
          const x = geo.cx + Math.cos(th) * rr;
          const y = geo.cy - Math.sin(th) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(94,234,212,0.075)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(94,234,212,0.22)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      // Re ψ — hue = arg ψ, brightness = |ψ|, run-length batched by hue bin.
      if (showWave) {
        let bin = -1;
        let runStart = 0;
        const flush = (to: number) => {
          if (bin < 0) return;
          const mid = Math.min(samples, Math.round((runStart + to) / 2));
          const c = densityPhaseColor(angArr[mid], magArr[mid] * 1.12, palette, 1.08, 1.7);
          ctx.strokeStyle = rgbCss(c, Math.max(0.08, c.a));
          ctx.lineWidth = thickness;
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let i = runStart; i <= to; i++) {
            const [x, y] = pointAt(i);
            if (i === runStart) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          // additive glow pass for the brightest runs
          if (c.a > 0.55) {
            ctx.strokeStyle = rgbCss(c, 0.12);
            ctx.lineWidth = thickness * 4;
            ctx.stroke();
          }
        };
        for (let i = 0; i <= samples; i++) {
          const b = Math.floor((((angArr[i] / TAU) + 0.5) % 1) * HUE_BINS);
          if (b !== bin) {
            flush(i);
            bin = b;
            runStart = i;
          }
        }
        flush(samples);
      }

      // Nodes of the standing pattern.
      if (showInterference && rho > 0.35) {
        ctx.save();
        for (let i = 1; i <= samples; i++) {
          if (reArr[i] === 0 || reArr[i - 1] * reArr[i] < 0) {
            const th = (i - 0.5) * dTheta;
            const x = geo.cx + Math.cos(th) * (rPx - ampPx * 1.5);
            const y = geo.cy - Math.sin(th) * (rPx - ampPx * 1.5);
            ctx.fillStyle = `rgba(232,238,252,${(0.25 + 0.6 * rho).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(x, y, 1.8, 0, TAU);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // ── the accumulating round-trip phasor braid ─────────────────────────
      if (showInterference) {
        braidRef.current = (braidRef.current + dt * 2.1) % BRAID;
        const grown = 1 + Math.floor(braidRef.current);
        const inset = rPx * 0.52;
        const step = inset / BRAID;
        let x = geo.cx;
        let y = geo.cy;
        ctx.save();
        ctx.lineCap = 'round';
        for (let k = 0; k < grown; k++) {
          const ang = TAU * n * k - phaseRef.current;
          const nx = x + Math.cos(ang) * step;
          const ny = y - Math.sin(ang) * step;
          const c = phaseColor(ang, palette);
          ctx.strokeStyle = rgbCss(c, 0.22 + 0.5 * (1 - k / BRAID));
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(nx, ny);
          ctx.stroke();
          x = nx;
          y = ny;
        }
        // resultant = S_k, normalised per lap
        ctx.strokeStyle = 'rgba(251,191,36,0.9)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(geo.cx, geo.cy);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(251,191,36,0.95)';
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, TAU);
        ctx.fill();
        ctx.restore();
        const per = Math.hypot(x - geo.cx, y - geo.cy) / (grown * step);
        ctx.save();
        ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = 'rgba(251,191,36,0.85)';
        ctx.fillText(`|S|/k = ${per.toFixed(3)}`, geo.cx + 6, geo.cy + inset * 0.72);
        ctx.restore();
      }

      // ── seam: the closure mismatch e^{i2πn} − 1 at θ = 0 ──────────────────
      if (showInterference) {
        const th0 = 0;
        const rOut = rPx + ampPx * reArr[0];
        const x0 = geo.cx + Math.cos(th0) * rOut;
        const y0 = geo.cy - Math.sin(th0) * rOut;
        const gap = base.seamMagnitude; // |e^{i2πn} − 1| ∈ [0,2]
        const len = Math.min(64, gap * 26);
        const ang = -phaseRef.current;
        const x1 = x0 + Math.cos(ang) * len;
        const y1 = y0 - Math.sin(ang) * len;
        ctx.save();
        ctx.strokeStyle = gap > 0.15 ? 'rgba(251,113,133,0.95)' : 'rgba(52,211,153,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x0, y0, 3, 0, TAU);
        ctx.fillStyle = 'rgba(232,238,252,0.9)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x1, y1, 3, 0, TAU);
        ctx.fillStyle = gap > 0.15 ? 'rgba(251,113,133,0.95)' : 'rgba(52,211,153,0.9)';
        ctx.fill();
        ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = 'rgba(251,113,133,0.9)';
        ctx.fillText(
          gap > 0.15 ? `seam ${gap.toFixed(2)}` : 'closed: ψ(2π) = ψ(0)',
          x1 + 6,
          y1 - 4,
        );
        ctx.restore();
      }

      // ── lock flash ───────────────────────────────────────────────────────
      if (flash > 0.01) {
        const rr = rPx * (1.04 + (1 - Math.min(1, flash)) * 0.22);
        ctx.save();
        ctx.globalAlpha = Math.min(1, flash) * 0.5;
        ctx.strokeStyle = 'rgba(94,234,212,0.9)';
        ctx.lineWidth = 2 + 6 * flash;
        ctx.beginPath();
        ctx.arc(geo.cx, geo.cy, rr, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      // ── HUD ──────────────────────────────────────────────────────────────
      ctx.save();
      ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      const locked = Math.abs(residual) < 0.02;
      ctx.fillStyle = locked ? 'rgba(52,211,153,0.95)' : 'rgba(251,191,36,0.95)';
      ctx.fillText(
        `n = ${n.toFixed(3)}  ·  Q = ${quality.toFixed(3)}  ·  ${locked ? `LOCKED  2πr = ${nInt}λ` : 'destructive: 2πr ≠ integer·λ'}`,
        geo.cx,
        Math.min(geo.bottom - 6, geo.cy + rPx + ampPx + 26),
      );
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(159,176,204,0.7)';
      ctx.fillText(
        `r = ${base.rAU.toFixed(2)} a₀ = ${base.radiusNm.toFixed(3)} nm   λ = ${lamAU.toFixed(2)} a₀ = ${(lamAU * BOHR_RADIUS_M * 1e9).toFixed(3)} nm`,
        geo.right - 4,
        geo.top + 4,
      );
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(107,125,153,0.9)';
      ctx.fillText(
        pBool(p, 'wavelengthLock', true)
          ? 'Re ψ → radius · arg ψ → hue · |ψ| → brightness · λ is locked to 2πr/n — unlock it to sweep n by dragging'
          : 'Re ψ → radius · arg ψ → hue · |ψ| → brightness · drag the ring to sweep n = 2πr/λ',
        geo.left,
        geo.bottom + 14,
      );
      ctx.restore();
    },
    [geometry, palette, setParam, slug],
  );

  useAnimationClock(({ dt, elapsed }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (scaleMode) {
      const { w, h, dpr } = sizeRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
      }
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawOrbit(ctx, dt, elapsed);
  });

  /* --------------------------------- drag ---------------------------------- */
  const onPointer = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>, kind: 'down' | 'move' | 'up') => {
      if (kind === 'up') {
        dragRef.current = false;
        return;
      }
      if (scaleMode) return;
      if (kind === 'down') {
        dragRef.current = true;
        ev.currentTarget.setPointerCapture?.(ev.pointerId);
        interruptDemo();
      }
      if (!dragRef.current) return;
      const geo = geometry();
      const rect = ev.currentTarget.getBoundingClientRect();
      const px = Math.hypot(ev.clientX - rect.left - geo.cx, ev.clientY - rect.top - geo.cy);
      const r = pixelsToRadius(px, geo.fit);
      setParam(slug, 'radiusAU', Math.round(r * 1000) / 1000);
    },
    [geometry, interruptDemo, scaleMode, setParam, slug],
  );

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden bg-obsidian"
      onPointerDown={(e) => onPointer(e, 'down')}
      onPointerMove={(e) => onPointer(e, 'move')}
      onPointerUp={(e) => onPointer(e, 'up')}
      onPointerCancel={(e) => onPointer(e, 'up')}
      style={{ touchAction: scaleMode ? 'auto' : 'none' }}
      role="application"
      aria-label="de Broglie standing-wave orbit"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block" />
      {scaleMode ? <ScalePanel slug={slug} /> : null}
    </div>
  );
}
