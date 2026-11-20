'use client';

/**
 * Dipole Transitions — inspector tab: the selection-rule probe rig.
 *
 * Every preset pair of hydrogenic states is evaluated with the same engine the
 * simulation uses — closed-form angular factor, 24×32 angular quadrature,
 * 12 000-panel radial Simpson — and the resulting |d_fi| is tabulated and plotted
 * on a log scale so the "zeros" are visibly at the 10⁻¹⁶ round-off floor rather
 * than merely small. Clicking a row loads that transition into the atom.
 */

import { useCallback } from 'react';
import { PlotCanvas, label, plotFrame, plotGrid } from '@/components/ui/PlotCanvas';
import { Tex } from '@/lib/math';
import { PillButton, SectionTitle, cx } from '@/components/ui/controls';
import { pBool, pNum, useSimStore } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import { dipoleZ, RULE_CASES } from './dipole';

const ROW_H = 30;

export function SelectionRulePanel({ slug }: { slug: SimSlug }) {
  const params = useSimStore((s) => s.params[slug]);
  const setParams = useSimStore((s) => s.setParams);
  const interruptDemo = useSimStore((s) => s.interruptDemo);
  const Z = Math.max(1, Math.min(4, Math.round(pNum(params, 'nuclearZ', 1))));
  const cur = {
    n: pNum(params, 'iN', 1),
    l: pNum(params, 'iL', 0),
    m: pNum(params, 'iM', 0),
    N: pNum(params, 'fN', 2),
    L: pNum(params, 'fL', 1),
    M: pNum(params, 'fM', 0),
  };

  const rows = RULE_CASES.map((c) => {
    const [n, l, m] = c.states.i;
    const [N, L, M] = c.states.f;
    const el = dipoleZ(n, l, m, N, L, M, Z);
    return { c, el, active: n === cur.n && l === cur.l && m === cur.m && N === cur.N && L === cur.L && M === cur.M };
  });
  const current = dipoleZ(cur.n, cur.l, cur.m, cur.N, cur.L, cur.M, Z);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const pad = { l: 34, r: 10, t: 16, b: 18 };
      plotFrame(ctx, w, h, pad);
      plotGrid(ctx, w, h, pad, rows.length, 4);
      const lo = -18;
      const hi = 1;
      const x = (v: number) => {
        const e = v > 0 ? Math.log10(v) : lo;
        return pad.l + ((w - pad.l - pad.r) * (Math.max(lo, e) - lo)) / (hi - lo);
      };
      rows.forEach((r, i) => {
        const y = pad.t + ((h - pad.t - pad.b) * (i + 0.5)) / rows.length;
        const barH = Math.max(5, (h - pad.t - pad.b) / rows.length - 7);
        const xv = x(r.el.abs);
        ctx.fillStyle = r.el.allowed ? (r.active ? 'rgba(94,234,212,0.95)' : 'rgba(94,234,212,0.55)') : 'rgba(251,113,133,0.55)';
        ctx.fillRect(pad.l, y - barH / 2, Math.max(1.5, xv - pad.l), barH);
        ctx.strokeStyle = r.active ? 'rgba(232,238,252,0.8)' : 'rgba(148,163,184,0.18)';
        ctx.lineWidth = r.active ? 1.4 : 1;
        ctx.strokeRect(pad.l, y - barH / 2, w - pad.l - pad.r, barH);
        label(ctx, r.el.allowed ? 'E1' : 'dark', 6, y + 3, r.el.allowed ? 'rgba(94,234,212,0.9)' : 'rgba(251,113,133,0.9)', 9);
        label(ctx, r.el.abs.toExponential(1), xv + 4, y + 3, 'rgba(148,163,184,0.85)', 9);
        label(ctx, r.c.label, pad.l + 4, y - 1, 'rgba(232,238,252,0.72)', 9);
      });
      label(ctx, '|d_fi| (e·a₀), log scale', pad.l + 2, h - 5, 'rgba(148,163,184,0.6)', 9);
      label(ctx, '10⁻¹⁸', pad.l, pad.t - 4, 'rgba(148,163,184,0.55)', 8.5);
      label(ctx, '10⁰', w - pad.r - 16, pad.t - 4, 'rgba(148,163,184,0.55)', 8.5);
    },
    // Z changes the elements; `rows` is rebuilt every render so it is the dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Z, rows.map((r) => r.el.abs.toExponential(3) + (r.active ? '*' : '')).join()],
  );

  const pick = (i: [number, number, number], f: [number, number, number]) => {
    interruptDemo();
    setParams(slug, {
      iN: i[0],
      iL: i[1],
      iM: i[2],
      fN: f[0],
      fL: f[1],
      fM: f[2],
      probeForbidden: false,
    });
  };

  return (
    <div className="space-y-3">
      <SectionTitle>E1 selection rules · Z = {Z}</SectionTitle>
      <p className="text-[11.5px] leading-relaxed text-ink-dim">
        The bar length is |⟨f|ẑ|i⟩| on a logarithmic axis, so a forbidden line is not
        “small” — it sits at the floating-point floor of the angular quadrature
        (≈10⁻¹⁶), which is what “exactly zero” means numerically.
      </p>

      <PlotCanvas draw={draw} height={ROW_H * rows.length + 34} deps={[Z, rows.length]} background="transparent" />

      <div className="space-y-1">
        {rows.map((r) => (
          <button
            key={r.c.id}
            type="button"
            onClick={() => pick(r.c.states.i, r.c.states.f)}
            className={cx(
              'w-full rounded-lg border px-2 py-1.5 text-left transition-colors',
              r.active
                ? 'border-plasma/40 bg-plasma/10'
                : 'border-hairline bg-obsidian-2/60 hover:border-hairline-bright hover:bg-white/[0.04]',
            )}
            title={r.c.note}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11.5px] text-ink">{r.c.label}</span>
              <span
                className={cx(
                  'font-mono text-[10.5px]',
                  r.el.allowed ? 'text-quantum' : 'text-solar',
                )}
              >
                {r.el.abs.toExponential(2)}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-ink-faint">
              Δℓ = {r.el.angular.deltaL}, Δm = {r.el.angular.deltaM} · closed {r.el.angular.closed.toFixed(6)} vs
              quadrature {r.el.angular.numeric.toExponential(2)}
            </div>
          </button>
        ))}
      </div>

      <SectionTitle right={<span className="font-mono text-[10.5px] text-ink">{current.abs.toExponential(3)} e·a₀</span>}>
        Current transition
      </SectionTitle>
      <div className="rounded-lg border border-hairline bg-obsidian-2/60 px-2 py-2 text-[11.5px] text-ink-dim">
        <Tex tex={current.allowed ? `\\langle f|\\hat z|i\\rangle = ${current.d.toFixed(6)}\\,e a_0` : `\\langle f|\\hat z|i\\rangle = 0`} />
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{current.reason}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <PillButton onClick={() => setParams(slug, { render: 'cloud' })}>ψ cloud</PillButton>
        <PillButton onClick={() => setParams(slug, { render: 'bloch' })}>Bloch</PillButton>
        <PillButton onClick={() => setParams(slug, { render: 'both' })}>Both</PillButton>
        <PillButton
          active={pBool(params, 'replay', false)}
          tone="accent"
          onClick={() => setParams(slug, { replay: !pBool(params, 'replay', false) })}
          title="Restart the pulse from t = 0 with the atom in |i⟩"
        >
          re-arm shot
        </PillButton>
      </div>
    </div>
  );
}

export default SelectionRulePanel;
