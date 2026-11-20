'use client';

/**
 * Sim 7 — Spectral Transitions & Dipole Radiation: the stage viewport.
 *
 * Two stacked canvases, one animation clock, zero per-frame React state:
 *
 *  • the *bottom* canvas is a 132×132 bitmap of |Ψ(y,z)|² for
 *    Ψ = b_i ψ_i + b_f e^{−iω₁₂τ} ψ_f, upscaled by CSS so the phase wheel
 *    smooths out. The two orbital profiles are pre-computed once per transition;
 *  • the *top* canvas is transparent and carries the Bloch sphere, the
 *    population and field/dipole charts, the ẑ axis, the E(t) arrow lattice, the
 *    ⟨d⟩ needle and the spectral line.
 *
 * Physics runs in the rotating frame (RWA): `advance()` in atom.ts steps the
 * envelope amplitudes with fixed-sub-stepped RK4 (or the exact SU(2) propagator,
 * and automatically the latter when RK4 would need > 4096 substeps), while the
 * optical phase used for the visuals runs on its own 0.42 Hz strobe so that
 * ω₁₂ = 1.55·10¹⁶ s⁻¹ is watchable. Dragging inside the Bloch panel orbits it.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { pBool, pNum, pStr, useSimStore } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import {
  advance,
  blochFromState,
  initialDriveState,
  populations,
  rabiFormula,
  resetDriveState,
  type DriveConfig,
  type DriveState,
} from './atom';
import { planeState, RULE_CASES } from './dipole';
import { cloudExtent, computeAtom, OPTICAL_HZ, transitionKey } from './physics';
import {
  clearHistory,
  createHistory,
  createLive,
  drawBloch,
  drawCloudOverlay,
  drawFieldDipole,
  drawPopulations,
  drawTransitionLine,
  paintCloud,
  pushHistory,
  pushTrail,
  type CloudProfiles,
  type History,
  type LiveAtom,
} from './render';

const CLOUD_PX = 132;
const TAU = Math.PI * 2;
/** Minimum wall milliseconds between store write-backs of the live read-outs. */
const WRITEBACK_MS = 240;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  w: number;
  h: number;
  dpr: number;
  cloud: Box | null;
  bloch: Box | null;
  pop: Box;
  field: Box | null;
  line: Box;
}

function panel(
  ctx: CanvasRenderingContext2D,
  b: Box,
  title?: string,
): void {
  const { x, y, w, h } = b;
  ctx.save();
  ctx.strokeStyle = 'rgba(148,163,184,0.16)';
  ctx.lineWidth = 1;
  const r = Math.min(10, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.stroke();
  if (title) {
    ctx.fillStyle = 'rgba(148,163,184,0.7)';
    ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(title, x + 8, y + 13);
  }
  ctx.restore();
}

export default function DipoleCanvas({ slug }: { slug: SimSlug }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cloudRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);

  const imgRef = useRef<ImageData | null>(null);
  const profRef = useRef<CloudProfiles | null>(null);
  const liveRef = useRef<LiveAtom>(createLive());
  const histRef = useRef<History>(createHistory());
  const driveRef = useRef<DriveState>(initialDriveState());
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const layoutRef = useRef<Layout | null>(null);
  const replayRef = useRef(false);
  const writeRef = useRef(0);
  const viewRef = useRef({ az: 0.72, el: 0.42 });

  const params = useSimStore((s) => s.params[slug]);
  const palette = useSimStore((s) => s.prefs.palette);
  const setParams = useSimStore((s) => s.setParams);
  const resetToken = useSimStore((s) => s.resetToken);

  const atom = computeAtom(params);
  const tKey = transitionKey(atom);

  /* ------------------------------- profiles ------------------------------- */

  // ψ_i and ψ_f on the x = 0 plane, rebuilt only when the transition changes.
  useEffect(() => {
    const a = computeAtom(useSimStore.getState().params[slug] ?? {});
    const extent = cloudExtent(Math.max(a.i.n, a.f.n), a.Z);
    const iRe = new Float32Array(CLOUD_PX * CLOUD_PX);
    const iIm = new Float32Array(CLOUD_PX * CLOUD_PX);
    const fRe = new Float32Array(CLOUD_PX * CLOUD_PX);
    const fIm = new Float32Array(CLOUD_PX * CLOUD_PX);
    planeState(a.i.n, a.i.l, a.i.m, CLOUD_PX, extent, a.Z, iRe, iIm);
    planeState(a.f.n, a.f.l, a.f.m, CLOUD_PX, extent, a.Z, fRe, fIm);
    let peak = 1e-9;
    for (let k = 0; k < iRe.length; k++) {
      const m = Math.hypot(iRe[k], iIm[k]) + Math.hypot(fRe[k], fIm[k]);
      if (m > peak) peak = m;
    }
    profRef.current = { size: CLOUD_PX, extent, iRe, iIm, fRe, fIm, peak };
    const cloud = cloudRef.current;
    const cctx = cloud?.getContext('2d') ?? null;
    if (cloud && cctx) {
      cloud.width = CLOUD_PX;
      cloud.height = CLOUD_PX;
      imgRef.current = cctx.createImageData(CLOUD_PX, CLOUD_PX);
    }
    resetDriveState(driveRef.current);
    clearHistory(histRef.current);
  }, [slug, tKey, resetToken]);

  /* ------------------------------ re-arm hooks ---------------------------- */

  const replay = pBool(params, 'replay', false);
  useEffect(() => {
    if (replayRef.current === replay) return;
    replayRef.current = replay;
    resetDriveState(driveRef.current);
    clearHistory(histRef.current);
    const l = liveRef.current;
    l.trail.fill(0);
    l.trailHead = 0;
    l.optPhase = 0;
  }, [replay]);

  // The dark-line probe snaps the quantum numbers onto the selected rule case.
  const probeOn = pBool(params, 'probeForbidden', false);
  const probeCase = pStr(params, 'probeCase', 'ls-2s');
  useEffect(() => {
    if (!probeOn) return;
    const c = RULE_CASES.find((r) => r.id === probeCase) ?? RULE_CASES[1];
    const [n, l, m] = c.states.i;
    const [n2, l2, m2] = c.states.f;
    if (
      pNum(params, 'iN', 1) === n &&
      pNum(params, 'iL', 0) === l &&
      pNum(params, 'iM', 0) === m &&
      pNum(params, 'fN', 2) === n2 &&
      pNum(params, 'fL', 1) === l2 &&
      pNum(params, 'fM', 0) === m2
    ) {
      return;
    }
    setParams(slug, { iN: n, iL: l, iM: m, fN: n2, fL: l2, fM: m2 });
  }, [probeOn, probeCase, slug, setParams, params]);

  /* --------------------------------- layout ------------------------------- */

  const measure = useCallback((): Layout | null => {
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const w = Math.max(240, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));
    const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    const prev = sizeRef.current;
    if (prev.w !== w || prev.h !== h || prev.dpr !== dpr) {
      sizeRef.current = { w, h, dpr };
      const main = mainRef.current;
      if (main) {
        main.width = Math.round(w * dpr);
        main.height = Math.round(h * dpr);
      }
    }

    const store = useSimStore.getState();
    const st = store.params[slug] ?? {};
    const inspector = store.inspectorOpen && w > 760;
    const left = 14;
    const right = w - (inspector ? 344 : 16);
    const top = 64;
    const bottom = h - 46;
    const availW = Math.max(140, right - left);
    const availH = Math.max(180, bottom - top);
    const gap = 10;

    const tall = availH > 440;
    const popH = tall ? 108 : 124;
    const fieldH = tall ? 94 : 0;
    const stageH = Math.max(140, availH - popH - fieldH - gap * (tall ? 2 : 1));
    const mode = pStr(st, 'render', 'both');

    const cloudBox: Box | null =
      mode === 'bloch'
        ? null
        : {
            x: left,
            y: top,
            w: Math.max(120, Math.min(stageH, tall ? (availW - gap) / 2 : availW)),
            h: Math.max(120, Math.min(stageH, tall ? (availW - gap) / 2 : availW)),
          };
    const blochBox: Box | null =
      mode === 'cloud'
        ? null
        : cloudBox
          ? { x: left + cloudBox.w + gap, y: top, w: Math.max(120, availW - cloudBox.w - gap), h: stageH }
          : { x: left, y: top, w: availW, h: stageH };

    let sy = top + stageH + gap;
    const pop: Box = { x: left, y: sy, w: availW, h: popH };
    sy += popH + gap;
    const field: Box | null = fieldH > 0 ? { x: left, y: sy, w: availW, h: fieldH } : null;
    const line: Box = cloudBox
      ? { x: cloudBox.x + 4, y: cloudBox.y + 4, w: cloudBox.w - 8, h: 22 }
      : { x: left, y: top + 4, w: Math.min(300, availW), h: 22 };

    const layout: Layout = { w, h, dpr, cloud: cloudBox, bloch: blochBox, pop, field, line };
    layoutRef.current = layout;

    const cloud = cloudRef.current;
    if (cloud) {
      const s = cloud.style;
      if (cloudBox) {
        const px = `${Math.round(cloudBox.x)}px`;
        const py = `${Math.round(cloudBox.y)}px`;
        const pw = `${Math.round(cloudBox.w)}px`;
        if (s.left !== px || s.top !== py || s.width !== pw) {
          s.left = px;
          s.top = py;
          s.width = pw;
          s.height = pw;
          s.display = 'block';
        }
      } else if (s.display !== 'none') {
        s.display = 'none';
      }
    }
    return layout;
  }, [slug]);

  /* --------------------------------- frame -------------------------------- */

  useAnimationClock(
    ({ dt }) => {
      const main = mainRef.current;
      const cloud = cloudRef.current;
      if (!main || !cloud) return;
      const ctx = main.getContext('2d');
      const cctx = cloud.getContext('2d');
      if (!ctx || !cctx) return;

      const lay = measure();
      if (!lay) return;
      const st = useSimStore.getState().params[slug] ?? {};
      const a = computeAtom(st);
      const live = liveRef.current;
      const hist = histRef.current;
      const drive = driveRef.current;

      const nsPerSecond = Math.max(1e-4, pNum(st, 'timeDilation', 0.02));
      const physicalDt = dt * nsPerSecond * 1e-9; // seconds of real physics this frame
      const cfg: DriveConfig = {
        omega0: a.omega0,
        delta: a.detuning,
        rabi: a.driveRabi,
        gamma: a.gamma,
      };
      if (dt > 0) {
        const report = advance(drive, cfg, physicalDt, {
          forceMethod: a.integrator,
          maxSubSteps: 4096,
        });
        live.subSteps = report.subSteps;
        live.method = report.method;
        live.optPhase = (live.optPhase + TAU * OPTICAL_HZ * dt) % (TAU * 1000);
      }
      live.tNs = drive.t * 1e9;
      live.pulseArea = drive.pulseArea;

      const pop = populations(drive);
      const bl = blochFromState(drive);
      live.biRe = drive.amp.up.re;
      live.biIm = drive.amp.up.im;
      live.bfRe = drive.amp.down.re;
      live.bfIm = drive.amp.down.im;
      live.p1 = pop.p1;
      live.p2 = pop.p2;
      live.u = bl.u;
      live.v = bl.v;
      live.w = bl.w;
      live.dipole = 2 * (live.biRe * live.bfRe + live.biIm * live.bfIm) * a.dFi;
      if (dt > 0) {
        pushTrail(live);
        pushHistory(hist, live.tNs, pop.p1, pop.p2, rabiFormula(cfg, drive.t));
      }

      /* --- paint --------------------------------------------------------- */
      const { w, h, dpr } = lay;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const prof = profRef.current;
      const img = imgRef.current;
      if (lay.cloud && prof && img) {
        paintCloud(
          img,
          prof,
          live,
          a,
          pBool(st, 'phaseColor', true),
          pNum(st, 'cloudOpacity', 1),
          palette,
        );
        cctx.putImageData(img, 0, 0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(lay.cloud.x, lay.cloud.y, lay.cloud.w, lay.cloud.h);
        ctx.clip();
        ctx.translate(lay.cloud.x, lay.cloud.y);
        drawCloudOverlay(
          ctx,
          lay.cloud.w,
          lay.cloud.h,
          a,
          live,
          pBool(st, 'showField', true),
        );
        ctx.restore();
        panel(ctx, lay.cloud);
      }
      if (lay.line) {
        ctx.save();
        ctx.translate(lay.line.x, lay.line.y);
        drawTransitionLine(ctx, lay.line.w, lay.line.h, a);
        ctx.restore();
      }
      if (lay.bloch) {
        panel(ctx, lay.bloch, 'Bloch sphere · ⟨σ⃗⟩ = (u, v, w)');
        ctx.save();
        ctx.translate(lay.bloch.x, lay.bloch.y);
        drawBloch(ctx, lay.bloch.w, lay.bloch.h, live, a, viewRef.current, palette);
        ctx.restore();
      }
      panel(ctx, lay.pop, 'Population P₁ / P₂');
      ctx.save();
      ctx.translate(lay.pop.x, lay.pop.y);
      drawPopulations(ctx, lay.pop.w, lay.pop.h, hist, a, live);
      ctx.restore();
      if (lay.field) {
        panel(ctx, lay.field, 'Drive E(t) and dipole ⟨d⟩(t)');
        ctx.save();
        ctx.translate(lay.field.x, lay.field.y);
        drawFieldDipole(ctx, lay.field.w, lay.field.h, a, live);
        ctx.restore();
      }

      /* --- mirror live numbers for the telemetry pill --------------------- */
      const now = typeof performance === 'undefined' ? Date.now() : performance.now();
      if (now - writeRef.current > WRITEBACK_MS) {
        writeRef.current = now;
        setParams(slug, {
          p2Live: pop.p2,
          pulseArea: drive.pulseArea,
          tLiveNs: live.tNs,
          dipoleLive: live.dipole,
          emittedLive: drive.emitted,
          subSteps: live.subSteps,
          integratorLive: live.method,
        });
      }
    },
    { maxDt: 0.05 },
  );

  /* -------------------------- drag to orbit the sphere -------------------- */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const down = (e: PointerEvent) => {
      const lay = layoutRef.current;
      if (!lay?.bloch) return;
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const b = lay.bloch;
      if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) return;
      dragging = true;
      lx = x;
      ly = y;
      host.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      viewRef.current.az += (x - lx) * 0.008;
      viewRef.current.el = Math.max(-1.4, Math.min(1.4, viewRef.current.el + (y - ly) * 0.008));
      lx = x;
      ly = y;
    };
    const up = (e: PointerEvent) => {
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
      dragging = false;
    };
    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
    return () => {
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
    };
  }, []);

  /* ------------------------------ mount / resize -------------------------- */

  useEffect(() => {
    measure();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(host);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden" data-sim="dipole-transitions">
      <canvas
        ref={cloudRef}
        className="absolute"
        style={{ borderRadius: 10 }}
        aria-label="Probability density slice along ẑ"
      />
      <canvas
        ref={mainRef}
        className="absolute inset-0 h-full w-full"
        aria-label="Driven two-level atom: Bloch sphere and populations"
      />
      <div className="pointer-events-none absolute bottom-2 left-4 right-4 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[10.5px] text-ink-faint">
        <span className="font-mono">
          {atom.iLabel} → {atom.fLabel}
        </span>
        <span className="font-mono">d_fi = {atom.dFi.toFixed(5)} e·a₀</span>
        <span className="font-mono">Ω_R = {atom.rabi.toExponential(3)} s⁻¹</span>
        <span className="font-mono">Ω = {atom.omegaGen.toExponential(3)} s⁻¹</span>
        <span className="font-mono">{atom.element.verdict}</span>
      </div>
    </div>
  );
}
