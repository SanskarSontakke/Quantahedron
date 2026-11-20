'use client';

/**
 * 2D Double-Slit — "Which-path" inspector tab.
 *
 * The complementarity rig: it plots the Englert–Greenberger–Yasinov bound
 * V² + D² ≤ 1 for the *current* detector setting and drops a marker at the
 * visibility the solver actually measured on the phosphor histogram. Every
 * number on this panel is either a closed-form function of `decoherence` or a
 * read-back from the accumulated hits — nothing is decorative.
 */

import { useCallback } from 'react';
import { PlotCanvas } from '@/components/ui/PlotCanvas';
import { PillButton, SectionTitle, Segmented, Toggle, cx } from '@/components/ui/controls';
import { useSimStore, pBool, pNum } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';

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

export default function DetectorTab({ slug }: { slug: SimSlug }) {
  const params = useSimStore((s) => s.params[slug]);
  const setParam = useSimStore((s) => s.setParam);
  const p = params ?? {};

  const on = pBool(p, 'whichPath', false);
  const delta = Math.min(1, Math.max(0, pNum(p, 'decoherence', 1)));
  const slit = Math.round(pNum(p, 'whichPathSlit', 0)) >= 1 ? 1 : 0;
  const measured = Math.min(1, Math.max(0, pNum(p, 'measuredV', 0)));
  const hits = Math.round(pNum(p, 'hits', 0));
  const packets = Math.round(pNum(p, 'packets', 0));
  const norm = pNum(p, 'fieldNorm', 0);
  const engine = typeof p.engineLabel === 'string' && p.engineLabel ? p.engineLabel : 'solver';

  // φ = (π/2)·δ ⇒ the ± coin leaves coherence cos φ; D is its complement.
  const phi = (Math.PI / 2) * delta;
  const vTheory = Math.abs(Math.cos(phi));
  const dTheory = Math.abs(Math.sin(phi));
  const bound = measured * measured + dTheory * dTheory;
  const erased = Math.abs(measured - vTheory) < 0.12;

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const pad = { l: 24, r: 8, t: 10, b: 16 };
      const iw = w - pad.l - pad.r;
      const ih = h - pad.t - pad.b;
      const px = (x: number): number => pad.l + x * iw;
      const py = (y: number): number => pad.t + (1 - y) * ih;

      ctx.strokeStyle = 'rgba(148,163,184,0.16)';
      ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) {
        ctx.beginPath();
        ctx.moveTo(pad.l, py(g / 4));
        ctx.lineTo(w - pad.r, py(g / 4));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(pad.l, py(1));
      ctx.lineTo(pad.l, py(0));
      ctx.lineTo(px(1), py(0));
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.stroke();

      // V(δ) = |cos((π/2)δ)| and its complement D(δ) = |sin((π/2)δ)|.
      const curve = (f: (x: number) => number, color: string, dash: boolean): void => {
        ctx.save();
        ctx.setLineDash(dash ? [4, 3] : []);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i <= 120; i++) {
          const x = i / 120;
          const y = f(x);
          if (i === 0) ctx.moveTo(px(x), py(y));
          else ctx.lineTo(px(x), py(y));
        }
        ctx.stroke();
        ctx.restore();
      };
      curve((x) => Math.abs(Math.cos((Math.PI / 2) * x)), 'rgba(94,234,212,0.95)', false);
      curve((x) => Math.abs(Math.sin((Math.PI / 2) * x)), 'rgba(251,113,133,0.9)', true);

      // Current setting + the visibility the screen actually delivered.
      ctx.strokeStyle = 'rgba(129,140,248,0.5)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(px(delta), py(0));
      ctx.lineTo(px(delta), py(1));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(251,191,36,0.95)';
      ctx.beginPath();
      ctx.arc(px(delta), py(measured), 3.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = INK;
      ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText('1.0', 4, py(1) + 3);
      ctx.fillText('0', 8, py(0) + 3);
      ctx.fillText('decoherence δ →', pad.l, h - 5);
      ctx.fillText('V measured', px(delta) + 6, py(measured) - 11);
    },
    [delta, measured],
  );

  return (
    <div className="pb-2">
      <SectionTitle>Which-path detector</SectionTitle>
      <Toggle
        label="Mark one slit per electron"
        checked={on}
        help="Each emitted packet gets ±φ = ±(π/2)·δ across the whole arm feeding the marked slit — a phase plate whose edge sits between the apertures, i.e. the back-action of a readable two-state path marker."
        onChange={(v) => setParam(slug, 'whichPath', v)}
      />
      <Segmented
        label="Marked aperture"
        value={String(slit)}
        options={[
          { value: '0', label: 'Upper slit' },
          { value: '1', label: 'Lower slit' },
        ]}
        onChange={(v) => setParam(slug, 'whichPathSlit', Number(v))}
      />
      <PlotCanvas draw={draw} deps={[delta, measured, on]} height={126} />

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat label="V measured" value={measured.toFixed(3)} tone="var(--color-plasma)" />
        <Stat label="V = |cos φ|" value={vTheory.toFixed(3)} tone="var(--color-ink-dim)" />
        <Stat label="D = |sin φ|" value={dTheory.toFixed(3)} tone="var(--color-collapse)" />
        <Stat
          label="V² + D² ≤ 1"
          value={bound.toFixed(3)}
          tone={bound <= 1.02 ? 'var(--color-quantum)' : 'var(--color-solar)'}
        />
        <Stat label="hits / e⁻" value={`${hits} / ${packets}`} />
        <Stat label="‖ψ‖ (lattice)" value={`${norm.toFixed(3)} · ${engine}`} />
      </div>

      <p className={cx('mt-2 text-[10.5px] leading-relaxed', erased ? 'text-ink-faint' : 'text-solar')}>
        {on
          ? erased
            ? 'The screen matches the bound: the marker carries just enough path information to wash the fringes by exactly cos φ.'
            : 'Still settling — keep accumulating hits, or nudge δ: the measured visibility converges to |cos φ| as the histogram fills.'
          : 'Detector off: every electron is emitted with the same phase, so the two apertures stay mutually coherent and V → 1.'}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <PillButton
          onClick={() => setParam(slug, 'clearToken', pNum(p, 'clearToken', 0) + 1)}
          title="Empty the phosphor histogram and the field"
        >
          Clear screen
        </PillButton>
        <PillButton
          onClick={() => {
            setParam(slug, 'whichPath', true);
            setParam(slug, 'decoherence', 1);
          }}
          title="π/2 mark: full path information, no fringes"
        >
          Which-path on
        </PillButton>
        <PillButton
          onClick={() => {
            setParam(slug, 'whichPath', true);
            setParam(slug, 'decoherence', 0);
          }}
          title="Zero-strength mark: eraser back to full visibility"
        >
          Quantum eraser
        </PillButton>
      </div>
    </div>
  );
}
