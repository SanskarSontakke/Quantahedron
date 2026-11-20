'use client';

/**
 * Sim 4 — Quantum Tunneling & Barrier Lab viewport.
 *
 * Two panels share one Canvas-2D surface and one rAF clock:
 *
 *   beam line   V(x) skyline + phase-coloured |ψ|² columns from the split-step
 *               propagator, the dashed e^(−κx) evanescent envelope over the
 *               classically forbidden columns, the two detector planes that
 *               bill T_sim / R_sim, and an optional Re ψ / Im ψ overlay.
 *   T(E)        the exact closed-form transmission curve (256 energies), the
 *               shaded evanescent region, the k·gap = nπ resonance comb with its
 *               T = 1 dots, the packet's own ΔE band and the *measured* point.
 *   STM         constant-current imaging: true vs apparent topography plus the
 *               I ∝ V·T(d) trace, all from the same closed form.
 *
 * `view` picks which panels are laid out; `stmMode` swaps the beam for the tip.
 * Nothing here is React state — the solver publishes into `liveTunnel` and the
 * HUD reads that port back, so 60 fps costs zero re-renders.
 */

import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { phaseColor, rgbCss, type Palette } from '@/lib/colorMap';
import { evanescentKappa } from '@/engine/physics/splitStepFFT';
import { pBool, pNum, useSimStore } from '@/store/useSimStore';
import type { SimParams, SimSlug } from '@/simulations/types';
import {
  auToU,
  clampNum,
  geomOf,
  groupVelocity,
  liveTunnel,
  massOf,
  probeEnergy,
  showAnalytical,
  showEvanescent,
  stmActive,
  stmScan,
  tCurveOf,
  TUN_BOX_AU,
  TUN_ORIGIN_AU,
  TUN_VIEWS,
  viewOf,
  analyticalT,
} from './model';
import { useTunnelSolver, type TunnelSolverState } from './useTunnelSolver';

const ACCENT = '#fbbf24';
const SKY = 'rgba(56,189,248,';
const MINT = 'rgba(94,234,212,';
const ROSE = 'rgba(251,113,133,';
const DIM = 'rgba(148,163,184,0.35)';
const INK = 'rgba(226,232,240,0.92)';
const FAINT = 'rgba(148,163,184,0.62)';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const PHASE_STEPS = 72;
const ALPHA_STEPS = 10;

interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Geo {
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  beam: Panel;
  curve: Panel;
}

interface Chip {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function buildLut(palette: Palette): string[] {
  const out: string[] = new Array<string>(PHASE_STEPS * ALPHA_STEPS);
  for (let i = 0; i < PHASE_STEPS; i++) {
    const c = phaseColor((i / PHASE_STEPS) * Math.PI * 2 - Math.PI, palette);
    for (let a = 0; a < ALPHA_STEPS; a++) out[i * ALPHA_STEPS + a] = rgbCss(c, (a + 1) / ALPHA_STEPS);
  }
  return out;
}

function sci(v: number, d = 2): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  return Math.abs(v) < 1e-3 || Math.abs(v) >= 1e4 ? v.toExponential(d) : v.toFixed(d);
}

function driftText(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v === 0 ? '0' : v.toExponential(1);
}

const VIEW_LABELS: Record<string, string> = {
  wave: '1 beam',
  transmission: '2 T(E)',
  both: '3 both',
};

export default function TunnelCanvas({ slug }: { slug: SimSlug }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const chipsRef = useRef<Chip[]>([]);
  const fpsRef = useRef(0);
  const lastTickRef = useRef(0);
  const scratchRef = useRef({ dens: new Float64Array(0), phase: new Float64Array(0) });

  const solver = useTunnelSolver();
  const palette = useSimStore((s) => s.prefs.palette);
  const resetToken = useSimStore((s) => s.resetToken);
  const params = useSimStore((s) => s.params[slug]);
  const interruptDemo = useSimStore((s) => s.interruptDemo);
  const setParam = useSimStore((s) => s.setParam);
  const lut = useMemo(() => buildLut(palette), [palette]);

  const live = useCallback((): SimParams => useSimStore.getState().params[slug] ?? {}, [slug]);

  /* ------------------------------- geometry -------------------------------- */

  const geometry = useCallback((): Geo => {
    const { w, h } = sizeRef.current;
    const st = useSimStore.getState();
    const wide = st.inspectorOpen && w > 900;
    const left = 54;
    const right = Math.max(left + 140, w - (wide ? 344 : 18));
    const top = 78;
    const hudH = h > 520 ? 44 : 30;
    const bottom = Math.max(top + 140, h - hudH - 12);
    const plotW = Math.max(80, right - left);
    const plotH = Math.max(90, bottom - top);
    const gapY = 26;
    const beamH = Math.max(90, plotH * 0.56 - gapY / 2);
    const curveH = Math.max(80, plotH - beamH - gapY);
    return {
      w,
      h,
      left,
      right,
      top,
      bottom,
      beam: { x: left, y: top, w: plotW, h: beamH },
      curve: { x: left, y: top + beamH + gapY, w: plotW, h: curveH },
    };
  }, []);

  const layout = useCallback((g: Geo, view: string): { beam: Panel | null; curve: Panel | null } => {
    if (view === 'wave') return { beam: { ...g.beam, h: g.beam.h + g.curve.h + 26 }, curve: null };
    if (view === 'transmission') return { beam: null, curve: { ...g.curve, y: g.top, h: g.curve.h + g.beam.h + 26 } };
    return { beam: g.beam, curve: g.curve };
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

  /* ------------------------------- chrome ---------------------------------- */

  const drawChrome = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, p: SimParams, st: TunnelSolverState): void => {
    const chips: Chip[] = [];
    let x = g.left;
    const y = 26;
    const h = 22;
    const current = viewOf(p);
    const stm = stmActive(p);
    ctx.font = `600 11px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const v of TUN_VIEWS) {
      const label = VIEW_LABELS[v] ?? v;
      const w = Math.max(54, ctx.measureText(label).width + 18);
      const active = v === current;
      ctx.fillStyle = active ? 'rgba(251,191,36,0.18)' : 'rgba(148,163,184,0.07)';
      ctx.strokeStyle = active ? 'rgba(251,191,36,0.7)' : 'rgba(148,163,184,0.2)';
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
    const extras: [string, string, boolean][] = [
      ['launch', '\u27f2 relaunch', false],
      ['stm', stm ? 'STM: on' : 'STM: off', stm],
      ['logT', pBool(p, 'logT', true) ? 'log T' : 'linear T', pBool(p, 'logT', true)],
    ];
    for (const [id, label, active] of extras) {
      const w = Math.max(52, ctx.measureText(label).width + 18);
      ctx.fillStyle = active ? 'rgba(56,189,248,0.16)' : 'rgba(148,163,184,0.07)';
      ctx.strokeStyle = active ? 'rgba(56,189,248,0.6)' : 'rgba(148,163,184,0.2)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? INK : FAINT;
      ctx.fillText(label, x + 9, y + h / 2 + 0.5);
      chips.push({ id, x, y, w, h });
      x += w + 6;
    }
    chipsRef.current = chips;

    const geom = geomOf(p);
    const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
    ctx.fillStyle = INK;
    ctx.font = `600 13px ${MONO}`;
    ctx.fillText('TUNNELING   T(E) = [1 + V₀²sinh²(κa)/4E(V₀−E)]⁻¹', g.left, 10);
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = FAINT;
    ctx.fillText(
      `split-step Fourier · N=${gridLabel(st.setup)} · ${geom.kind} barrier, V₀ = ${geom.v0.toFixed(1)}, E₀ = ${e0.toFixed(1)} (${e0 < geom.v0 ? 'below' : 'above'})`,
      g.left,
      58,
    );
  }, []);

  /* ------------------------------ beam panel -------------------------------- */

  const drawBeam = useCallback(
    (ctx: CanvasRenderingContext2D, panel: Panel, p: SimParams, st: TunnelSolverState, table: string[]): void => {
      const setup = st.setup;
      ctx.font = `10px ${MONO}`;
      ctx.textBaseline = 'alphabetic';
      if (!setup) {
        ctx.fillStyle = FAINT;
        ctx.fillText('initialising beam line…', panel.x, panel.y + 14);
        return;
      }
      const { n, dx, v, geom, mass } = setup;
      const re = st.frame.re;
      const im = st.frame.im;
      if (re.length !== n || im.length !== n) {
        ctx.fillStyle = FAINT;
        ctx.fillText('waiting for the first Strang step…', panel.x, panel.y + 14);
        return;
      }

      const y0 = panel.y + panel.h - 22;
      const vTop = panel.y + 14;
      const barH = Math.max(40, y0 - vTop);
      const vRef = Math.max(geom.vmax * 1.12, 0.5);
      const dxPix = panel.w / n;
      const xPix = (u: number): number => panel.x + u * panel.w;
      const yForV = (val: number): number => y0 - clampNum(val / vRef, 0, 1.02) * barH;

      /* frame + baseline */
      ctx.strokeStyle = DIM;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(panel.x, y0 + 0.5);
      ctx.lineTo(panel.x + panel.w, y0 + 0.5);
      ctx.stroke();
      ctx.fillStyle = FAINT;
      ctx.fillText('V = 0', panel.x + panel.w - 30, y0 - 5);

      /* V(x) skyline */
      const showV = pBool(p, 'showPotential', true);
      const eProbe = probeEnergy(p);
      if (showV) {
        ctx.beginPath();
        ctx.moveTo(panel.x, y0);
        for (let j = 0; j < n; j++) {
          const y = yForV(v[j]);
          const x = panel.x + j * dxPix;
          ctx.lineTo(x, y);
          ctx.lineTo(x + dxPix, y);
        }
        ctx.lineTo(panel.x + panel.w, y0);
        ctx.closePath();
        ctx.fillStyle = 'rgba(120,140,170,0.17)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(148,163,184,0.62)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      /* classically forbidden columns for the probe energy */
      ctx.fillStyle = 'rgba(251,191,36,0.09)';
      for (let j = 0; j < n; j++) {
        if (v[j] <= eProbe) continue;
        ctx.fillRect(panel.x + j * dxPix, yForV(vRef), Math.max(1, dxPix + 0.4), y0 - yForV(vRef));
      }

      /* |ψ|² columns */
      const logMode = pBool(p, 'logDensity', false);
      const colorPhase = pBool(p, 'colorPhase', true);
      const showRi = pBool(p, 'showReIm', false);
      const densityH = barH * (showRi ? 0.5 : 0.68);
      const scratch = scratchRef.current;
      if (scratch.dens.length !== n) {
        scratch.dens = new Float64Array(n);
        scratch.phase = new Float64Array(n);
      }
      const dens = scratch.dens;
      const phase = scratch.phase;
      let peak = 1e-30;
      let incidentPeak = 1e-30;
      const jLeft = Math.min(n, Math.max(0, Math.round((geom.left - TUN_ORIGIN_AU) / dx)));
      for (let j = 0; j < n; j++) {
        const d = (re[j] * re[j] + im[j] * im[j]) * dx;
        dens[j] = d;
        phase[j] = Math.atan2(im[j], re[j]);
        if (d > peak) peak = d;
        if (j < jLeft && d > incidentPeak) incidentPeak = d;
      }
      const ref = Math.max(peak, setup.peak0 * 0.35, 1e-12);

      for (let j = 0; j < n; j++) {
        let q = dens[j] / ref;
        if (logMode) q = Math.pow(10, -3 * (1 - clampNum(q, 0, 1))) * (q > 0 ? 1 : 0);
        q = clampNum(q, 0, 1);
        if (q < 0.0015) continue;
        const hp = q * densityH;
        if (colorPhase) {
          const pi = clampNum(Math.floor(((phase[j] + Math.PI) / (Math.PI * 2)) * PHASE_STEPS), 0, PHASE_STEPS - 1);
          const ai = clampNum(Math.floor(q * ALPHA_STEPS), 0, ALPHA_STEPS - 1);
          ctx.fillStyle = table[pi * ALPHA_STEPS + ai];
        } else {
          ctx.fillStyle = `${SKY}${(0.12 + 0.8 * q).toFixed(3)})`;
        }
        ctx.fillRect(panel.x + j * dxPix, y0 - hp, Math.max(1, dxPix + 0.6), hp);
      }

      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const q = logMode ? Math.pow(10, -3 * (1 - clampNum(dens[j] / ref, 0, 1))) : clampNum(dens[j] / ref, 0, 1);
        const x = panel.x + (j + 0.5) * dxPix;
        const y = y0 - clampNum(q, 0, 1) * densityH;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = logMode ? 'rgba(251,191,36,0.95)' : `${SKY}0.95)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      /* dashed evanescent envelope e^(−κx) over the forbidden region */
      const kappa = evanescentKappa(eProbe, geom.vmax, mass, 1);
      if (showEvanescent(p) && eProbe < geom.vmax && kappa > 1e-6) {
        const d0 = Math.max(incidentPeak, ref * 0.02);
        const xLeft = geom.left;
        const xRight = geom.right;
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(251,191,36,0.95)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        const steps = 96;
        for (let i = 0; i <= steps; i++) {
          const xa = xLeft + ((xRight - xLeft) * i) / steps;
          const env = d0 * Math.exp(-2 * kappa * (xa - xLeft));
          const q = clampNum(env / ref, 0, 1);
          const x = xPix(auToU(xa));
          const y = y0 - q * densityH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(251,191,36,0.9)';
        ctx.fillText(
          `e^(−κx) envelope, κ = ${kappa.toFixed(3)} → density ×e^(−2κa) = ${Math.exp(-2 * kappa * (xRight - xLeft)).toExponential(2)}`,
          xPix(auToU(xLeft)) + 6,
          y0 - densityH - 8,
        );
      }

      /* detector planes for the T / R ledger */
      const dL = xPix(auToU(geom.left - 1));
      const dR = xPix(auToU(geom.right + 1));
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `${ROSE}0.6)`;
      ctx.beginPath();
      ctx.moveTo(dL, panel.y + 10);
      ctx.lineTo(dL, y0);
      ctx.stroke();
      ctx.strokeStyle = `${MINT}0.65)`;
      ctx.beginPath();
      ctx.moveTo(dR, panel.y + 10);
      ctx.lineTo(dR, y0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `9px ${MONO}`;
      ctx.fillStyle = `${ROSE}0.9)`;
      ctx.fillText('R plane', dL + 3, panel.y + 18);
      ctx.fillStyle = `${MINT}0.9)`;
      ctx.fillText('T plane', dR + 3, panel.y + 18);

      /* launch marker */
      const uLaunch = clampNum(pNum(p, 'packetX', 0.16), 0.02, 0.44);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(226,232,240,0.4)';
      ctx.beginPath();
      ctx.moveTo(panel.x + uLaunch * panel.w, panel.y + 10);
      ctx.lineTo(panel.x + uLaunch * panel.w, y0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = FAINT;
      ctx.fillText('launch', panel.x + uLaunch * panel.w + 3, y0 - 8);

      /* Re ψ / Im ψ overlay */
      if (showRi) {
        let amp = 1e-30;
        for (let j = 0; j < n; j++) {
          const a = Math.abs(re[j]);
          const b = Math.abs(im[j]);
          if (a > amp) amp = a;
          if (b > amp) amp = b;
        }
        const midY = panel.y + barH * 0.18;
        const half = barH * 0.14;
        ctx.strokeStyle = 'rgba(148,163,184,0.3)';
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(panel.x, midY);
        ctx.lineTo(panel.x + panel.w, midY);
        ctx.stroke();
        ctx.setLineDash([]);
        const curve = (buf: Float64Array, color: string, width: number): void => {
          ctx.beginPath();
          for (let j = 0; j < n; j++) {
            const x = panel.x + (j + 0.5) * dxPix;
            const y = midY - (buf[j] / amp) * half;
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.stroke();
        };
        curve(im, `${ROSE}0.9)`, 1.1);
        curve(re, `${SKY}0.95)`, 1.6);
      }

      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = FAINT;
      ctx.fillText(
        `${logMode ? 'log |ψ|² (3 decades)' : '|ψ(x,t)|²'}   hue = arg ψ   ·   x ∈ [−${(TUN_BOX_AU / 2).toFixed(0)}, +${(TUN_BOX_AU / 2).toFixed(0)}] a.u.`,
        panel.x + 6,
        panel.y + 12,
      );
    },
    [],
  );

  /* ------------------------------ T(E) panel -------------------------------- */

  const drawCurve = useCallback((ctx: CanvasRenderingContext2D, panel: Panel, p: SimParams): void => {
    const curve = tCurveOf(p);
    const log = pBool(p, 'logT', true);
    const geom = geomOf(p);
    const eMax = Math.max(curve.eMax, 1e-6);
    const x0 = panel.x + 4;
    const x1 = panel.x + panel.w;
    const yTop = panel.y + 16;
    const yBot = panel.y + panel.h - 22;
    const xPix = (e: number): number => x0 + clampNum(e / eMax, 0, 1) * (x1 - x0);
    const tPix = (t: number): number =>
      log
        ? yBot - ((Math.log10(clampNum(t, 1e-4, 1)) + 4) / 4) * (yBot - yTop)
        : yBot - clampNum(t, 0, 1) * (yBot - yTop);

    /* axes */
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, yBot + 0.5);
    ctx.lineTo(x1, yBot + 0.5);
    ctx.moveTo(x0 + 0.5, yTop - 6);
    ctx.lineTo(x0 + 0.5, yBot);
    ctx.stroke();
    ctx.font = `9px ${MONO}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = FAINT;
    if (log) {
      for (let d = 0; d <= 4; d++) {
        const t = Math.pow(10, -d);
        const y = tPix(t);
        ctx.strokeStyle = 'rgba(148,163,184,0.09)';
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillStyle = FAINT;
        ctx.fillText(d === 0 ? '1' : `1e-${d}`, x0 - 4, y);
      }
    } else {
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const y = tPix(t);
        ctx.strokeStyle = 'rgba(148,163,184,0.09)';
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillStyle = FAINT;
        ctx.fillText(t.toFixed(2), x0 - 4, y);
      }
    }
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const e = (eMax * i) / 4;
      ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
      ctx.fillStyle = FAINT;
      ctx.fillText(e.toFixed(1), xPix(e), yBot + 12);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = FAINT;
    ctx.fillText('E (a.u.)', x1 - 46, yBot + 20);
    ctx.save();
    ctx.translate(panel.x + 10, (yTop + yBot) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('transmission T', 0, 0);
    ctx.restore();

    /* evanescent (classically forbidden) region */
    if (geom.v0 < eMax) {
      ctx.fillStyle = 'rgba(251,191,36,0.08)';
      ctx.fillRect(x0, yTop - 6, Math.max(0, xPix(geom.v0) - x0), yBot - yTop + 6);
      ctx.fillStyle = 'rgba(251,191,36,0.8)';
      ctx.font = `9px ${MONO}`;
      ctx.fillText('E < V₀', x0 + 5, yTop + 4);
    }

    /* packet energy band: σ_E = ℏ²k₀Δk/m from the launch spectrum */
    const dk = clampNum(pNum(p, 'sigmaK', 12), 1, 90) / TUN_BOX_AU;
    const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
    const mass = massOf(p);
    const k0 = Math.sqrt(2 * mass * e0);
    const dE = (k0 * dk) / mass;
    const bandLo = xPix(Math.max(0, e0 - 2 * dE));
    const bandHi = xPix(e0 + 2 * dE);
    ctx.fillStyle = `${SKY}0.08)`;
    ctx.fillRect(bandLo, yTop - 6, Math.max(1, bandHi - bandLo), yBot - yTop + 6);

    /* the exact curve */
    if (showAnalytical(p)) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < curve.e.length; i++) {
        const y = tPix(curve.t[i]);
        const x = xPix(curve.e[i]);
        if (!Number.isFinite(y)) continue;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else {
      ctx.fillStyle = FAINT;
      ctx.font = `10px ${MONO}`;
      ctx.fillText('analytical curve hidden', x0 + 8, yTop + 4);
    }

    /* resonance comb: k·gap = nπ ⇒ T = 1 */
    if (curve.resonances.length > 0) {
      for (const e of curve.resonances) {
        const x = xPix(e);
        ctx.strokeStyle = `${MINT}0.55)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yBot);
        ctx.lineTo(x, yBot - 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, tPix(1), 3, 0, Math.PI * 2);
        ctx.fillStyle = `${MINT}0.95)`;
        ctx.fill();
      }
      ctx.fillStyle = `${MINT}0.9)`;
      ctx.font = `9px ${MONO}`;
      ctx.fillText(`${curve.resonances.length} exact T = 1 resonances`, x1 - 150, yTop + 4);
    }

    /* markers */
    const tE0 = analyticalT(p, e0);
    const xE0 = xPix(e0);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xE0, yTop - 6);
    ctx.lineTo(xE0, yBot);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(xE0, tPix(tE0), 4, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = INK;
    ctx.fillText(`E₀ = ${e0.toFixed(2)}   T = ${sci(tE0)}`, xE0 + 7, yTop + 16);

    const probe = probeEnergy(p);
    if (Math.abs(probe - e0) > 1e-6) {
      const xp = xPix(probe);
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = `${ROSE}0.85)`;
      ctx.beginPath();
      ctx.moveTo(xp, yTop - 6);
      ctx.lineTo(xp, yBot);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(xp, tPix(analyticalT(p, probe)), 3.4, 0, Math.PI * 2);
      ctx.fillStyle = `${ROSE}0.95)`;
      ctx.fill();
      ctx.fillStyle = `${ROSE}0.95)`;
      ctx.fillText(`probe ${probe.toFixed(2)} → T = ${sci(analyticalT(p, probe))}`, xp + 6, yTop + 30);
    }

    /* measured point from the running simulation */
    if (liveTunnel.ready && liveTunnel.tMeasured > 0) {
      const ym = tPix(liveTunnel.tMeasured);
      ctx.strokeStyle = `${MINT}0.9)`;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, ym);
      ctx.lineTo(x1, ym);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(xE0, ym, 5, 0, Math.PI * 2);
      ctx.strokeStyle = `${MINT}1)`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = `${MINT}0.95)`;
      ctx.fillText(
        `simulated T = ${liveTunnel.tMeasured.toFixed(4)}${liveTunnel.resolved ? ' (converged)' : ' (still separating)'}`,
        xE0 + 7,
        ym - 8,
      );
    }
  }, []);

  /* ------------------------------- STM panel -------------------------------- */

  const drawStm = useCallback((ctx: CanvasRenderingContext2D, panel: Panel, p: SimParams): void => {
    const scan = stmScan(p);
    const x0 = panel.x + 4;
    const x1 = panel.x + panel.w;
    const topoBot = panel.y + panel.h * 0.6;
    const curTop = panel.y + panel.h * 0.68;
    const curBot = panel.y + panel.h - 20;
    const hMax = Math.max(0.05, ...Array.from(scan.appH), ...Array.from(scan.trueH)) * 1.35;
    const yForH = (h: number): number => topoBot - (h / hMax) * (topoBot - panel.y - 26);
    const xPix = (i: number, count: number): number => x0 + (i / (count - 1)) * (x1 - x0);

    ctx.font = `10px ${MONO}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.fillText('STM tip mode — constant-current imaging, I ∝ V·T(d)', panel.x + 6, panel.y + 12);

    /* sample body */
    ctx.beginPath();
    ctx.moveTo(x0, topoBot);
    for (let i = 0; i < scan.u.length; i++) ctx.lineTo(xPix(i, scan.u.length), yForH(scan.trueH[i]));
    ctx.lineTo(x1, topoBot);
    ctx.closePath();
    ctx.fillStyle = 'rgba(120,140,170,0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.7)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.strokeStyle = DIM;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, yForH(0));
    ctx.lineTo(x1, yForH(0));
    ctx.stroke();
    ctx.setLineDash([]);

    /* apparent topography + tip */
    ctx.beginPath();
    for (let i = 0; i < scan.u.length; i++) {
      const x = xPix(i, scan.u.length);
      const y = yForH(scan.appH[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `${SKY}0.95)`;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    for (const frac of [0.18, 0.5, 0.82]) {
      const i = Math.round(frac * (scan.u.length - 1));
      const x = xPix(i, scan.u.length);
      const y = yForH(scan.appH[i]);
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 20);
      ctx.lineTo(x + 6, y - 20);
      ctx.lineTo(x, y - 3);
      ctx.closePath();
      ctx.fillStyle = 'rgba(226,232,240,0.75)';
      ctx.fill();
    }
    ctx.fillStyle = FAINT;
    ctx.fillText(`set point d = ${(clampNum(pNum(p, 'stmHeight', 0.05), 0.006, 0.3) * TUN_BOX_AU).toFixed(2)} a.u.`, x0 + 4, panel.y + 28);
    ctx.fillStyle = `${SKY}0.95)`;
    ctx.fillText('apparent height (what the microscope reports)', x0 + 4, yForH(0) - 6);
    ctx.fillStyle = 'rgba(148,163,184,0.8)';
    ctx.fillText('true surface', x1 - 84, yForH(0) + 12);

    /* current trace */
    let cMax = 1e-12;
    for (const c of scan.cur) if (c > cMax) cMax = c;
    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.moveTo(x0, curBot);
    ctx.lineTo(x1, curBot);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < scan.cur.length; i++) {
      const x = xPix(i, scan.cur.length);
      const y = curBot - (scan.cur[i] / cMax) * (curBot - curTop);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `${ROSE}0.95)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = `${ROSE}0.95)`;
    ctx.fillText(`I/I₀  peak ${cMax.toExponential(1)}`, x0 + 4, curTop - 4);
    ctx.fillStyle = FAINT;
    ctx.fillText(
      `d ln I/dd = −2κ = −${scan.slope.toFixed(2)} a.u.⁻¹  →  one a.u. of gap = ×${Math.exp(scan.slope).toFixed(1)} in current`,
      x0 + 120,
      curTop - 4,
    );
  }, []);

  /* --------------------------------- HUD ------------------------------------ */

  const drawHud = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, st: TunnelSolverState, p: SimParams): void => {
      const frame = st.frame;
      liveTunnel.t = frame.simTime;
      liveTunnel.steps = frame.steps;
      liveTunnel.solverMs = frame.computeMs;
      liveTunnel.fps = fpsRef.current;
      liveTunnel.lastFrameMs = st.lastDelivery;

      const geom = geomOf(p);
      const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
      const mass = massOf(p);
      const kappa = evanescentKappa(e0, geom.vmax, mass, 1);
      const good = liveTunnel.drift < 1e-6;
      const y = g.bottom + 16;
      const cells: [string, string][] = [
        ['t', frame.simTime.toFixed(2)],
        ['‖ψ‖', liveTunnel.norm.toFixed(7)],
        ['drift', driftText(liveTunnel.drift)],
        ['T_sim', liveTunnel.transmitted.toFixed(5)],
        ['R_sim', liveTunnel.reflected.toFixed(5)],
        ['T(E₀)', sci(analyticalT(p, e0))],
        ['κ', kappa > 0 ? kappa.toFixed(3) : '0'],
        ['E₀/V₀', (e0 / geom.vmax).toFixed(3)],
        ['v_g', groupVelocity(e0, mass).toFixed(3)],
        ['fps', fpsRef.current.toFixed(0)],
        ['solve', `${frame.computeMs.toFixed(2)} ms/f`],
        ['grid', st.setup ? `N ${st.setup.n} · dx ${st.setup.dx.toFixed(4)}` : '—'],
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
        ctx.fillStyle =
          label === 'drift' ? (good ? `${MINT}0.95)` : 'rgba(251,191,36,0.95)') : label === 'T_sim' ? `${MINT}0.95)` : INK;
        ctx.fillText(value, x + lw, y);
        x += lw + ctx.measureText(value).width + 14;
      }
    },
    [],
  );

  /* ------------------------------- compose ---------------------------------- */

  const drawFrame = useCallback(
    (ctx: CanvasRenderingContext2D, g: Geo, p: SimParams, st: TunnelSolverState, view: string): void => {
      const { beam, curve } = layout(g, view);
      const stm = stmActive(p);
      if (beam) {
        if (stm) drawStm(ctx, beam, p);
        else drawBeam(ctx, beam, p, st, lut);
      }
      if (curve) drawCurve(ctx, curve, p);
      drawHud(ctx, g, st, p);
    },
    [drawBeam, drawCurve, drawHud, drawStm, layout, lut],
  );

  /* ------------------------------- the clock -------------------------------- */

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
      bg.addColorStop(0, 'rgba(251,191,36,0.06)');
      bg.addColorStop(0.55, 'rgba(8,12,20,0)');
      bg.addColorStop(1, 'rgba(2,4,9,0.62)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const store = useSimStore.getState();
      const p = store.params[slug] ?? {};
      const view = viewOf(p);
      if (info.dt > 0 && store.playing) {
        const per = Math.round(clampNum(pNum(p, 'stepsPerFrame', 8), 1, 32));
        const rate = clampNum(info.dt * 60 * store.timeScale, 0.2, 4);
        solver.pump(p, Math.max(1, Math.round(per * rate)));
      } else {
        solver.pump(p, 0);
      }

      const st = solver.stateRef.current;
      const g = geometry();
      drawChrome(ctx, g, p, st);
      drawFrame(ctx, g, p, st, view);
    },
    [drawChrome, drawFrame, geometry, slug, solver],
  );

  useAnimationClock(tick, { maxDt: 0.05 });

  useEffect(() => {
    solver.reset(live());
  }, [resetToken, solver, live]);

  /* -------------------------------- pointer --------------------------------- */

  const onPointerDown = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>): void => {
      const rect = ev.currentTarget.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      for (const chip of chipsRef.current) {
        if (px >= chip.x && px <= chip.x + chip.w && py >= chip.y && py <= chip.y + chip.h) {
          interruptDemo();
          if (chip.id.startsWith('view:')) setParam(slug, 'view', chip.id.slice(5));
          else if (chip.id === 'logT') setParam(slug, 'logT', !pBool(live(), 'logT', true));
          else if (chip.id === 'stm') setParam(slug, 'stmMode', !pBool(live(), 'stmMode', false));
          else if (chip.id === 'launch') {
            const next = Math.round(pNum(live(), 'launchToken', 0)) + 1;
            setParam(slug, 'launchToken', next);
            solver.reset(live());
          }
          return;
        }
      }
    },
    [interruptDemo, live, setParam, slug, solver],
  );

  const stm = pBool(params, 'stmMode', false);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden bg-obsidian"
      onPointerDown={onPointerDown}
      style={{ touchAction: 'manipulation' }}
      role="application"
      aria-label="Quantum tunneling beam line: split-step Fourier wavepacket against a barrier with the analytical T(E) curve"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block" />
      {stm ? null : (
        <div className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] text-ink-faint">
          drag V₀, a or E₀ while the packet is en route — ψ keeps flying, only V(x) changes
        </div>
      )}
    </div>
  );
}

/** Grid label for the chrome line, before the first setup exists. */
function gridLabel(setup: TunnelSolverState['setup']): string {
  return setup ? String(setup.n) : '…';
}
