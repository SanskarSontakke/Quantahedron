'use client';

/**
 * de Broglie Ring — inspector tab: the resonance curve itself.
 *
 * Q(n) = |sin(πnK)|/(K|sin πn|) is the normalised round-trip buildup, plotted
 * across the winding numbers the ring can take, with a live marker for the
 * current n and the 1/K leakage floor drawn between the peaks.
 */

import { useCallback } from 'react';
import { PlotCanvas, drawSeries, label, plotFrame, plotGrid } from '@/components/ui/PlotCanvas';
import { useSimParams } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import { CIRCUITS, buildup, ringState } from './physics';

const N_LO = 0.6;
const N_HI = 8.4;

export function ResonancePanel({ slug }: { slug: SimSlug }) {
  const params = useSimParams(slug);
  const r = ringState(params);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const pad = { l: 30, r: 12, t: 14, b: 20 };
      plotFrame(ctx, w, h, pad);
      plotGrid(ctx, w, h, pad, 4, 8);
      const toPx = (n: number, q: number): [number, number] => [
        pad.l + ((w - pad.l - pad.r) * (n - N_LO)) / (N_HI - N_LO),
        h - pad.b - (h - pad.t - pad.b) * (1 - Math.max(0, Math.min(1, q))),
      ];
      const steps = 900;
      const ys: number[] = [];
      for (let i = 0; i <= steps; i++) ys.push(buildup(N_LO + ((N_HI - N_LO) * i) / steps, CIRCUITS));
      drawSeries(
        ctx,
        { ys, color: '#818cf8', width: 1.6, fill: false },
        (i, sr) => [i / steps, sr.ys[i] * 0.98],
        { x0: N_LO, x1: N_HI, y0: 0, y1: 1 },
        toPx,
      );
      // 1/K floor between the peaks — how far the cancellation actually gets.
      drawSeries(
        ctx,
        { ys: new Array<number>(steps + 1).fill(1 / CIRCUITS), color: 'rgba(148,163,184,0.5)', width: 1, dashed: true },
        (i) => [i / steps, 1 / CIRCUITS],
        { x0: N_LO, x1: N_HI, y0: 0, y1: 1 },
        toPx,
      );
      for (let k = 1; k <= 8; k++) {
        const [x] = toPx(k, 1);
        ctx.strokeStyle = 'rgba(94,234,212,0.25)';
        ctx.beginPath();
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, h - pad.b);
        ctx.stroke();
        label(ctx, `${k}`, x - 3, h - pad.b + 12, 'rgba(148,163,184,0.7)', 9);
      }
      const [mx, my] = toPx(Math.max(N_LO, Math.min(N_HI, r.n)), buildup(r.n));
      ctx.fillStyle = 'rgba(251,191,36,0.95)';
      ctx.beginPath();
      ctx.arc(mx, my, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(251,191,36,0.45)';
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx, h - pad.b);
      ctx.stroke();
      label(ctx, `Q = ${r.quality.toFixed(3)}`, Math.min(w - 78, mx + 6), Math.max(pad.t + 10, my - 6), 'rgba(251,191,36,0.95)', 10);
      label(ctx, 'Q', pad.l - 22, pad.t + 8);
      label(ctx, 'winding n', w - pad.r - 52, h - 4, 'rgba(148,163,184,0.6)', 9);
    },
    [r.n, r.quality],
  );

  const lamAU = (2 * Math.PI * r.rAU) / Math.max(1e-6, r.nRaw);

  return (
    <div className="pt-1">
      <div className="mb-2 text-[11px] leading-relaxed text-ink-dim">
        Round-trip buildup <span className="font-mono">Q(n)</span> for K = {CIRCUITS} circuits. The peaks
        are the only radii where a matter wave can live; the dashed line at 1/K = {(1 / CIRCUITS).toFixed(3)}
        {' '}is how much amplitude survives per lap between them.
      </div>
      <PlotCanvas height={150} draw={draw} deps={[r.n, r.quality, r.nRaw]} />
      <dl className="mt-2 grid grid-cols-2 gap-1.5">
        <Mini label="r resonant at this n" value={`${((r.n * lamAU) / (2 * Math.PI)).toFixed(2)} a₀`} />
        <Mini label="current r" value={`${r.rAU.toFixed(2)} a₀`} />
        <Mini label="λ" value={`${lamAU.toFixed(2)} a₀`} />
        <Mini label="Δn from integer" value={`${r.residual >= 0 ? '+' : ''}${r.residual.toFixed(3)}`} />
      </dl>
    </div>
  );
}

function Mini({ label: t, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-obsidian-2/70 px-2 py-1">
      <dt className="text-[9px] uppercase tracking-wide text-ink-faint">{t}</dt>
      <dd className="font-mono text-[11.5px] text-ink" data-telemetry>
        {value}
      </dd>
    </div>
  );
}
