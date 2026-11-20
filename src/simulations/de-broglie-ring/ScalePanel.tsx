'use client';

/**
 * de Broglie Ring — Scale Explorer rig.
 *
 * A non-animated measurement panel: it reports λ = h/(γmv) for a real beam,
 * compares it with a real aperture, and draws the single-slit envelope
 * I(θ) = sinc²(π(a/λ)sinθ) inside a fixed 5° detector window. When λ ≪ a that
 * curve is flat at 1 across the whole window — the visual proof that a cricket
 * ball does not diffract.
 */

import { useCallback, useMemo } from 'react';
import { PlotCanvas, drawSeries, label, plotFrame, plotGrid, type PlotSeries } from '@/components/ui/PlotCanvas';
import { useSimParams, useSimStore } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import {
  MASS_PRESETS,
  PLANCK_LENGTH_M,
  PROTON_RADIUS_M,
  deBroglieSI,
  diffractionVerdict,
  formatAngle,
  formatEnergyEv,
  formatLength,
  formatMomentum,
  presetById,
  sci,
} from './physics';

const X_SPAN = 3;
/** Best angular resolution of a real detector: 1 µrad (2×10⁻⁴ arcsec). */
const DETECTOR_RES_RAD = 1e-6;
const ACCENT = '#818cf8';

interface Marks {
  label: string;
  metres: number;
}

const RULER: Marks[] = [
  { label: 'human 1 m', metres: 1 },
  { label: 'cell 10 µm', metres: 1e-5 },
  { label: 'virus 100 nm', metres: 1e-7 },
  { label: 'graphite d 0.21 nm', metres: 0.21e-9 },
  { label: 'proton 0.84 fm', metres: PROTON_RADIUS_M },
  { label: 'Planck', metres: PLANCK_LENGTH_M },
];

export function ScalePanel({ slug }: { slug: SimSlug }) {
  const params = useSimParams(slug);
  const setParams = useSimStore((s) => s.setParams);
  const interruptDemo = useSimStore((s) => s.interruptDemo);
  const d = useMemo(() => deBroglieSI(params), [params]);
  const verdict = useMemo(() => diffractionVerdict(d), [d]);
  const choice = presetById(String(params['massChoice'] ?? 'custom'));

  const apply = useCallback(
    (id: string) => {
      const preset = presetById(id);
      if (!preset) {
        setParams(slug, { massChoice: id });
        return;
      }
      setParams(slug, {
        massChoice: id,
        massKg: preset.massKg,
        speedMS: preset.speedMS,
        logMass: Math.log10(preset.massKg),
        logSpeed: Math.log10(preset.speedMS),
      });
      interruptDemo();
    },
    [setParams, slug, interruptDemo],
  );

  const drawEnvelope = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const pad = { l: 34, r: 12, t: 14, b: 20 };
      const theta1 = d.lambdaM / d.apertureM; // first-null half-angle, rad
      plotFrame(ctx, w, h, pad);
      plotGrid(ctx, w, h, pad, 4, 6);
      const toPx = (u: number, inten: number): [number, number] => [
        pad.l + ((w - pad.l - pad.r) * u) / X_SPAN,
        h - pad.b - (h - pad.t - pad.b) * Math.max(0, Math.min(1, inten)),
      ];
      const steps = 260;
      const ys: number[] = [];
      for (let i = 0; i <= steps; i++) {
        const u = (i / steps) * X_SPAN;
        const beta = Math.PI * u; // β = π(a/λ)sinθ ≈ π·θ/θ₁
        const s = Math.abs(beta) < 1e-9 ? 1 : Math.pow(Math.sin(beta) / beta, 2);
        ys.push(s);
      }
      drawSeries(
        ctx,
        { ys, color: ACCENT, width: 1.9, fill: true } satisfies PlotSeries,
        (i, sr) => [i / steps, sr.ys[i]],
        { x0: 0, x1: X_SPAN, y0: 0, y1: 1.05 },
        toPx,
      );
      // Detector-resolution cone: angles finer than DETECTOR_RES_RAD cannot be
      // distinguished by any real instrument, so everything left of the line is
      // physically unreadable no matter how bright it is.
      const uRes = DETECTOR_RES_RAD / Math.max(theta1, 1e-60);
      const cut = Math.min(X_SPAN, Math.max(uRes, 0));
      const [x0] = toPx(0, 0);
      const [x1] = toPx(cut, 0);
      ctx.save();
      ctx.fillStyle = uRes >= X_SPAN ? 'rgba(251,113,133,0.16)' : 'rgba(52,211,153,0.10)';
      ctx.fillRect(x0, pad.t, x1 - x0, h - pad.t - pad.b);
      ctx.strokeStyle = uRes >= X_SPAN ? 'rgba(251,113,133,0.85)' : 'rgba(52,211,153,0.75)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, pad.t);
      ctx.lineTo(x1, h - pad.b);
      ctx.stroke();
      ctx.restore();
      label(
        ctx,
        uRes >= X_SPAN
          ? 'pattern entirely inside the resolution cone'
          : `central lobe resolves at θ₁ = ${formatAngle(d.firstNullRad)}`,
        pad.l + 6,
        pad.t + 11,
        uRes >= X_SPAN ? 'rgba(251,113,133,0.95)' : 'rgba(52,211,153,0.95)',
      );
      label(ctx, 'I(θ)/I₀', pad.l - 32, pad.t + 9);
      label(ctx, 'θ/θ₁ = 1', toPx(1, 0)[0] - 18, h - pad.b + 12);
      label(ctx, '2', toPx(2, 0)[0] - 4, h - pad.b + 12);
      label(ctx, '3', toPx(3, 0)[0] - 4, h - pad.b + 12);
      label(ctx, '0', x0 - 5, h - pad.b + 12);
    },
    [d.apertureM, d.lambdaM, d.firstNullRad],
  );

  const drawRuler = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const pad = { l: 10, r: 10, t: 16, b: 22 };
      const lo = Math.log10(PLANCK_LENGTH_M);
      const hi = Math.log10(1);
      const xOf = (metres: number) =>
        pad.l + ((w - pad.l - pad.r) * (Math.log10(Math.max(metres, 1e-45)) - lo)) / (hi - lo);
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, h - pad.b);
      ctx.lineTo(w - pad.r, h - pad.b);
      ctx.stroke();
      ctx.restore();
      for (let dec = -35; dec <= 0; dec += 5) {
        const x = xOf(Math.pow(10, dec));
        ctx.strokeStyle = 'rgba(148,163,184,0.16)';
        ctx.beginPath();
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, h - pad.b);
        ctx.stroke();
        label(ctx, `1e${dec}`, x - 10, h - pad.b + 12, 'rgba(148,163,184,0.55)', 8.5);
      }
      for (const m of RULER) {
        const x = xOf(m.metres);
        ctx.strokeStyle = 'rgba(148,163,184,0.45)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x, pad.t + 2);
        ctx.lineTo(x, h - pad.b);
        ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, m.label, x + 2, pad.t + 8, 'rgba(159,176,204,0.75)', 8.5);
      }
      // aperture marker
      const xa = xOf(d.apertureM);
      ctx.strokeStyle = 'rgba(94,234,212,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xa, pad.t);
      ctx.lineTo(xa, h - pad.b);
      ctx.stroke();
      label(ctx, `aperture ${formatLength(d.apertureM)}`, Math.min(w - 120, xa + 4), h - pad.b - 6, 'rgba(94,234,212,0.9)', 9);
      // wavelength marker with glow
      const xl = xOf(d.lambdaM);
      const grd = ctx.createLinearGradient(xl - 26, 0, xl + 26, 0);
      grd.addColorStop(0, 'rgba(129,140,248,0)');
      grd.addColorStop(0.5, 'rgba(129,140,248,0.55)');
      grd.addColorStop(1, 'rgba(129,140,248,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(xl - 26, pad.t, 52, h - pad.t - pad.b);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(xl, pad.t);
      ctx.lineTo(xl, h - pad.b);
      ctx.stroke();
      label(ctx, `λ = ${formatLength(d.lambdaM)}`, Math.min(w - 120, xl + 4), pad.t + 22, ACCENT, 9.5);
    },
    [d.apertureM, d.lambdaM],
  );

  return (
    <div className="absolute inset-0 flex flex-col gap-2 overflow-y-auto p-3 text-ink sm:p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13px] font-medium">Scale Explorer — λ = h/(γmv)</h3>
        <span className="font-mono text-[10.5px] text-ink-faint">
          {choice ? choice.note : 'Custom beam — drive mass and speed from the Fields tab.'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {MASS_PRESETS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => apply(m.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              String(params['massChoice']) === m.id
                ? 'border-transparent bg-white/10 text-ink'
                : 'border-hairline text-ink-dim hover:text-ink'
            }`}
            style={String(params['massChoice']) === m.id ? { color: ACCENT } : undefined}
            title={`m = ${m.massKg.toExponential(3)} kg, v = ${m.speedMS.toExponential(2)} m/s`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="λ = h/p" value={formatLength(d.lambdaM)} sub={`${d.lambdaM.toExponential(4)} m`} tone="accent" />
        <Stat label="p = γmv" value={formatMomentum(d.pSI)} sub={`β = ${d.beta.toPrecision(4)} · γ = ${d.gamma.toFixed(4)}`} />
        <Stat
          label="λ / aperture"
          value={d.ratio.toExponential(3)}
          sub={`a = ${formatLength(d.apertureM)} ⇒ θ₁ = ${formatAngle(d.firstNullRad)}`}
          tone={d.ratio > 1e-3 ? 'good' : 'warn'}
        />
        <Stat
          label="kinetic energy"
          value={formatEnergyEv(d.kineticEv)}
          sub={d.relativistic ? `γ = ${d.gamma.toFixed(4)}: p = mv instead of γmv would give ${formatLength(d.lambdaNonRel)} (${(((d.lambdaNonRel / d.lambdaM) - 1) * 100).toFixed(1)} % high)` : 'non-relativistic regime'}
        />
      </div>

      <div className="glass rounded-xl p-2.5">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            Log ruler — λ against every aperture that exists
          </span>
          <span className="font-mono text-[10px] text-ink-faint">metres</span>
        </div>
        <PlotCanvas height={110} draw={drawRuler} deps={[d.lambdaM, d.apertureM]} />
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="glass rounded-xl p-2.5">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              Single-slit envelope I(θ) = sinc²(π(a/λ)·θ), axis in units of the first null θ₁ = λ/a
            </span>
            <span className="font-mono text-[10px] text-ink-faint">a/λ = {sci(d.apertureM / d.lambdaM)}</span>
          </div>
          <PlotCanvas height={150} draw={drawEnvelope} deps={[d.lambdaM, d.apertureM]} />
        </div>
        <div className="glass flex flex-col gap-1.5 rounded-xl p-2.5">
          <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Verdict</span>
          <p className={`text-[12.5px] font-medium leading-snug ${verdict.observable ? 'text-quantum' : 'text-solar'}`}>
            {verdict.headline}
          </p>
          <p className="text-[11.5px] leading-relaxed text-ink-dim">{verdict.detail}</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
            Rule of thumb: fringes need λ ≳ a/10. This beam has λ/a = {d.ratio.toExponential(2)},{verdict.observable ? ' so an aperture of this size is a genuine interferometer.' : ' so no aperture of any kind can resolve it.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label: t,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'good' | 'warn' | 'accent';
}) {
  const color =
    tone === 'good' ? 'text-quantum' : tone === 'warn' ? 'text-solar' : tone === 'accent' ? 'text-flux' : 'text-ink';
  return (
    <div className="glass rounded-xl px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-wide text-ink-faint">{t}</div>
      <div className={`font-mono text-[13.5px] ${color}`} data-telemetry>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[10px] leading-snug text-ink-faint">{sub}</div> : null}
    </div>
  );
}
