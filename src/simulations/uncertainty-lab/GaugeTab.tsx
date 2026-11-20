'use client';

/**
 * Uncertainty Forge — "Heisenberg audit" inspector tab.
 *
 * Everything here is either a closed-form function of the current envelope or a
 * read-back of the moments the canvas actually measured on it. The plot shows the
 * analytic minimum-uncertainty curve (σx·σp)² = ¼ + c²σ⁴ for the chirp in use,
 * the ħ/2 floor, and the point the solver landed on.
 */

import { useCallback } from 'react';
import { PlotCanvas } from '@/components/ui/PlotCanvas';
import { PillButton, SectionTitle, Segmented, cx } from '@/components/ui/controls';
import { useSimStore, pBool, pNum, pStr } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import { ENVELOPES, HEISENBERG_FLOOR, analyticSpreading, gaugeState } from './wavepacket';

const INK = 'rgba(148,163,184,0.75)';

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-obsidian-2/60 px-2 py-1.5">
      <div className="text-[9.5px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="font-mono text-[12.5px]" style={{ color: tone ?? 'var(--color-ink)' }}>
        {value}
      </div>
    </div>
  );
}

export default function GaugeTab({ slug }: { slug: SimSlug }) {
  const params = useSimStore((s) => s.params[slug]);
  const setParam = useSimStore((s) => s.setParam);
  const setParams = useSimStore((s) => s.setParams);
  const p = params ?? {};

  const envelope = pStr(p, 'envelope', 'gauss');
  const width = Math.max(0.04, pNum(p, 'width', 0.6));
  const chirp = pNum(p, 'chirp', 0);

  const sigmaX = pNum(p, 'sigmaX', 0);
  const sigmaP = pNum(p, 'sigmaP', 0);
  const product = pNum(p, 'product', 0);
  const analytic = pNum(p, 'analyticProduct', 0);
  const norm = pNum(p, 'waveNorm', 0);
  const t = pNum(p, 'evolveTime', 0);
  const sigma0 = pNum(p, 'sigma0', 0);
  const evolving = pBool(p, 'evolve', true);

  const live = norm > 1e-9 && product > 0;
  const state = gaugeState(product);
  // Closed-form σx(t) for the released state — only exact for the Gaussian family.
  const pred = envelope === 'gauss' ? analyticSpreading(sigma0, t, chirp) : 0;
  const spreadErr = pred > 0 && sigmaX > 0 ? Math.abs(sigmaX - pred) / pred : 0;
  // The floor every state must sit on or above, and the Gaussian curve it follows.

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const pad = { l: 26, r: 10, t: 12, b: 18 };
      const iw = w - pad.l - pad.r;
      const ih = h - pad.t - pad.b;
      const sMax = 3;
      const yMax = 3;
      const px = (s: number): number => pad.l + (s / sMax) * iw;
      const py = (v: number): number => pad.t + (1 - Math.min(1, v / yMax)) * ih;

      ctx.strokeStyle = 'rgba(148,163,184,0.16)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        ctx.beginPath();
        ctx.moveTo(pad.l, py((i / 6) * yMax));
        ctx.lineTo(w - pad.r, py((i / 6) * yMax));
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t);
      ctx.lineTo(pad.l, pad.t + ih);
      ctx.lineTo(w - pad.r, pad.t + ih);
      ctx.stroke();

      // The ħ/2 floor: the only place the gauge is allowed to be green.
      ctx.strokeStyle = 'rgba(52,211,153,0.75)';
      ctx.beginPath();
      ctx.moveTo(pad.l, py(HEISENBERG_FLOOR));
      ctx.lineTo(w - pad.r, py(HEISENBERG_FLOOR));
      ctx.stroke();

      // (σxσp)² = ¼ + c²σ⁴ for the chirp in use.
      ctx.strokeStyle = 'rgba(251,191,36,0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const s = (i / 160) * sMax;
        const v = Math.sqrt(0.25 + chirp * chirp * s * s * s * s);
        if (i === 0) ctx.moveTo(px(s), py(v));
        else ctx.lineTo(px(s), py(v));
      }
      ctx.stroke();

      // Where the solver actually is.
      if (live) {
        ctx.strokeStyle = 'rgba(129,140,248,0.5)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(px(width), pad.t + ih);
        ctx.lineTo(px(width), py(product));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = state === 'good' ? 'rgba(52,211,153,1)' : state === 'warn' ? 'rgba(251,191,36,1)' : 'rgba(251,113,133,1)';
        ctx.beginPath();
        ctx.arc(px(width), py(product), 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = INK;
      ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText(`${HEISENBERG_FLOOR.toFixed(1)} ħ/2`, 3, py(HEISENBERG_FLOOR) + 3);
      ctx.fillText('3', 8, py(3) + 3);
      ctx.fillText('σx (a₀) →', pad.l + 2, h - 6);
      ctx.textAlign = 'right';
      ctx.fillText('σx·σp', w - pad.r, pad.t - 2);
      ctx.textAlign = 'left';
    },
    [chirp, live, product, state, width],
  );

  const verdict = !live
    ? 'No normalised state yet — pick Freehand and drag across the upper panel to paint one.'
    : state === 'good'
      ? envelope === 'gauss'
        ? 'On the floor: the Gaussian is the *only* envelope that saturates σx·σp = ħ/2, and it does so at every width.'
        : 'Surprisingly at the floor for a non-Gaussian — check σp: the grid is too coarse to resolve the tails, so the second moment is under-counted.'
      : state === 'warn'
        ? 'Slightly off the floor. For a Gaussian that means chirp: the quadratic phase buys momentum spread without shrinking ψ.'
        : envelope === 'gauss'
          ? 'Far off the floor — chirp dominates. Reduce it, or widen σ until c·σ² is small against 1/(2σ).'
          : 'Above the floor as promised: a top-hat or Lorentzian needs infinitely many plane waves (sinc² and e^(−|k|) tails), so no finite σp can reach ħ/2.';

  return (
    <div className="pb-2">
      <SectionTitle>Heisenberg audit</SectionTitle>
      <Segmented
        label="Envelope"
        value={envelope}
        options={ENVELOPES.map((e) => ({ value: e.value, label: e.label }))}
        onChange={(v) => setParam(slug, 'envelope', v)}
      />
      <PlotCanvas draw={draw} deps={[chirp, live, product, state, width]} height={132} />

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat label="σx measured" value={live ? sigmaX.toFixed(4) : '—'} tone="var(--color-plasma)" />
        <Stat label="σp measured" value={live ? sigmaP.toFixed(4) : '—'} tone="var(--color-flux)" />
        <Stat
          label="σx·σp"
          value={live ? product.toFixed(5) : '—'}
          tone={state === 'good' ? 'var(--color-quantum)' : state === 'warn' ? 'var(--color-solar)' : 'var(--color-collapse)'}
        />
        <Stat
          label="× ħ/2 floor"
          value={live ? (product / HEISENBERG_FLOOR).toFixed(4) : '—'}
        />
        <Stat
          label="analytic (Gaussian)"
          value={envelope === 'gauss' && live ? analytic.toFixed(5) : 'reference'}
          tone="var(--color-ink-dim)"
        />
        <Stat
          label="Δ analytic − numeric"
          value={envelope === 'gauss' && live ? Math.abs(analytic - product).toExponential(2) : '—'}
          tone={envelope === 'gauss' && live && Math.abs(analytic - product) < 1e-3 ? 'var(--color-quantum)' : undefined}
        />
        <Stat label="⟨E⟩ = ⟨p²⟩/2" value={live ? pNum(p, 'energy', 0).toFixed(4) : '—'} />
        <Stat label="‖ψ‖²" value={norm.toFixed(5)} tone={Math.abs(norm - 1) < 1e-3 ? 'var(--color-quantum)' : 'var(--color-solar)'} />
      </div>

      <p className={cx('mt-2 text-[10.5px] leading-relaxed', state === 'good' ? 'text-ink-faint' : 'text-solar')}>
        {verdict}
      </p>
      {evolving && pred > 0 && t > 0 && live ? (
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
          Free spreading at t = {t.toFixed(3)}: the packet measures σx = {sigmaX.toFixed(4)} where
          √(σ²(1 + ct)² + t²/4σ²) predicts {pred.toFixed(4)} — {(100 * spreadErr).toFixed(3)}% apart. That is the
          spectral propagator being unitary rather than merely stable, and it is why σp never moves.
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <PillButton
          onClick={() => setParams(slug, { envelope: 'gauss', chirp: 0, tilt: 0, view: 'both' })}
          title="Back to the unique minimiser of the uncertainty product"
        >
          Minimum-uncertainty state
        </PillButton>
        <PillButton
          onClick={() => setParams(slug, { envelope: 'gauss', chirp: 2.5 })}
          title="Quadratic phase: σp grows while σx is untouched"
        >
          Chirp it
        </PillButton>
        <PillButton
          onClick={() => setParams(slug, { envelope: 'custom', drawClear: pNum(p, 'drawClear', 0) + 1 })}
          title="Empty the freehand buffer and start painting"
        >
          Clear drawing
        </PillButton>
        <PillButton
          onClick={() => setParam(slug, 'evolve', !evolving)}
          title="Release the packet under the exact kinetic propagator"
        >
          {evolving ? 'Freeze evolution' : 'Release packet'}
        </PillButton>
      </div>
    </div>
  );
}
