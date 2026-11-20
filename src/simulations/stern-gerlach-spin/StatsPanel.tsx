'use client';

/**
 * Stern–Gerlach Spin — inspector tab: beam-count statistics.
 *
 * The bench draws thicknesses from |P±χ|²; this tab answers the only question a
 * real experiment can ask, namely *do the atoms actually land there?*  A
 * deterministic Monte-Carlo run of `Atoms fired` atoms with the current `Shot seed`
 * (`sampleChain`, so the histogram is reproducible from the permalink) is laid
 * beside the exact engine prediction from the same projector chain, together with
 * the ±1σ binomial band, per-channel z-scores and a χ²/dof goodness-of-fit number.
 * Nothing here is decorative: counts come from the sampler, probabilities from
 * `runAnalyzerChain`, both from `./chain.ts` — the same two calls the canvas makes.
 */

import { useCallback } from 'react';
import { PlotCanvas, label, plotFrame, plotGrid } from '@/components/ui/PlotCanvas';
import { PillButton, SectionTitle, cx } from '@/components/ui/controls';
import { Tex } from '@/lib/math';
import { pBool, pNum, pStr, useSimStore } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import { buildModel, chainAt, channelKey, portLabel, shoot } from './chain';

const ROW_H = 34;

interface Row {
  key: string;
  title: string;
  theory: number;
  count: number;
  emp: number;
  sigma: number;
  z: number;
  absorbed: boolean;
}

export function BeamStatsPanel({ slug }: { slug: SimSlug }) {
  const params = useSimStore((s) => s.params[slug]);
  const setParams = useSimStore((s) => s.setParams);

  const m = buildModel(params);
  const turns = pNum(params, 'phaseTurnsLive', 0);
  const chain = chainAt(m, turns);
  const seed = Math.round(pNum(params, 'seed', 7));
  const beam = m.beamCount;
  const shot = shoot(m, turns, seed);
  const n = shot.shots;

  const rows: Row[] = chain.channels.map((c) => {
    const key = channelKey(c.path);
    const count = shot.counts.get(key) ?? 0;
    const p = c.probability;
    const emp = n > 0 ? count / n : 0;
    const sigma = Math.sqrt(Math.max(0, (p * (1 - p))) / Math.max(1, n));
    return {
      key,
      title: portLabel(c.path),
      theory: p,
      count,
      emp,
      sigma,
      z: sigma > 1e-12 ? (emp - p) / sigma : 0,
      absorbed: false,
    };
  });
  const missed = Math.max(0, n - shot.detected);
  {
    const p = chain.blocked;
    const emp = n > 0 ? missed / n : 0;
    const sigma = Math.sqrt(Math.max(0, p * (1 - p)) / Math.max(1, n));
    rows.push({
      key: 'absorbed',
      title: 'plugged',
      theory: p,
      count: missed,
      emp,
      sigma,
      z: sigma > 1e-12 ? (emp - p) / sigma : 0,
      absorbed: true,
    });
  }

  // Multinomial goodness of fit over every exit (including the absorbed class).
  let chi2 = 0;
  let dof = 0;
  for (const r of rows) {
    const expect = n * r.theory;
    if (expect < 1e-9) continue;
    dof += 1;
    chi2 += (r.count - expect) ** 2 / expect;
  }
  dof = Math.max(1, dof - 1);
  const ratio = n > 0 ? chi2 / dof : NaN;
  const tvd = 0.5 * rows.reduce((s, r) => s + Math.abs(r.emp - r.theory), 0);
  const maxZ = rows.reduce((s, r) => Math.max(s, Math.abs(r.z)), 0);
  const sumP = rows.reduce((s, r) => s + r.theory, 0);
  const sumN = rows.reduce((s, r) => s + r.count, 0);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const pad = { l: 44, r: 12, t: 16, b: 18 };
      plotFrame(ctx, w, h, pad);
      plotGrid(ctx, w, h, pad, rows.length, 4);
      const top = Math.max(0.06, ...rows.map((r) => Math.max(r.theory, r.emp + r.sigma)));
      const x = (v: number) => pad.l + ((w - pad.l - pad.r) * Math.max(0, Math.min(top, v))) / top;
      rows.forEach((r, i) => {
        const y = pad.t + ((h - pad.t - pad.b) * (i + 0.5)) / rows.length;
        const barH = Math.max(6, (h - pad.t - pad.b) / rows.length - 10);
        // exact |P±χ|² as a hollow bar, the dealt atoms as a solid one inside it
        ctx.fillStyle = r.absorbed ? 'rgba(251,113,133,0.16)' : 'rgba(96,165,250,0.18)';
        ctx.fillRect(pad.l, y - barH / 2, Math.max(0.6, x(r.theory) - pad.l), barH);
        ctx.strokeStyle = r.absorbed ? 'rgba(251,113,133,0.65)' : 'rgba(96,165,250,0.75)';
        ctx.lineWidth = 1;
        ctx.strokeRect(pad.l + 0.5, y - barH / 2 + 0.5, Math.max(0.6, x(r.theory) - pad.l), barH - 1);
        const inner = barH * 0.42;
        ctx.fillStyle = 'rgba(94,234,212,0.9)';
        ctx.fillRect(pad.l, y - inner / 2, Math.max(0.8, x(r.emp) - pad.l), inner);
        ctx.strokeStyle = 'rgba(232,238,252,0.55)';
        ctx.beginPath();
        ctx.moveTo(x(Math.max(0, r.emp - r.sigma)), y - inner);
        ctx.lineTo(x(Math.max(0, r.emp - r.sigma)), y + inner);
        ctx.moveTo(x(r.emp + r.sigma), y - inner);
        ctx.lineTo(x(r.emp + r.sigma), y + inner);
        ctx.moveTo(x(Math.max(0, r.emp - r.sigma)), y);
        ctx.lineTo(x(r.emp + r.sigma), y);
        ctx.stroke();
        label(ctx, r.title, 4, y + 3, r.absorbed ? 'rgba(251,113,133,0.9)' : 'rgba(232,238,252,0.75)', 9.5);
        label(ctx, `${r.count}`, x(r.theory) + 5, y - 1, 'rgba(94,234,212,0.9)', 9);
        label(ctx, `${(100 * r.theory).toFixed(2)}%`, x(r.theory) + 5, y + 9, 'rgba(148,163,184,0.8)', 9);
      });
      label(ctx, `exit fraction of ${n} atoms · solid = n/N ± 1σ, hollow = |P±χ|²`, pad.l + 2, h - 5, 'rgba(148,163,184,0.6)', 9);
      label(ctx, '0', pad.l - 12, h - pad.b + 11, 'rgba(148,163,184,0.55)', 8.5);
      label(ctx, `${(top * 100).toFixed(0)}%`, w - pad.r - 22, h - pad.b + 11, 'rgba(148,163,184,0.55)', 8.5);
    },
    // `rows` is rebuilt on every render; the joined signature is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows.map((r) => `${r.key}:${r.count}:${r.theory.toFixed(6)}`).join()],
  );

  const bump = (mult: number) => {
    const next = Math.max(0, Math.min(4000, Math.round((Math.max(beam, 40) * mult) / 10) * 10));
    setParams(slug, { beamCount: next });
  };

  return (
    <div className="space-y-3">
      <SectionTitle
        right={
          <span className="font-mono text-[10.5px] text-ink">
            N = {n} · detected {shot.detected}
          </span>
        }
      >
        Beam counter · seed {seed}
      </SectionTitle>
      <p className="text-[11.5px] leading-relaxed text-ink-dim">
        {n === 0
          ? 'No atoms are being fired — raise “Atoms fired” to build a histogram.'
          : `Each exit channel of ${m.stages.map((s) => s.label).join(' → ')} is dealt ${n} independent atoms. The hollow bar is the exact engine probability, the solid bar what the sampler actually produced, and the whisker the binomial ±1σ band. Atoms stopped by a plugged beam are the red class.`}
      </p>

      <PlotCanvas draw={draw} height={ROW_H * rows.length + 34} deps={[rows.length, n]} background="transparent" />

      <div className="overflow-hidden rounded-lg border border-hairline">
        <div className="grid grid-cols-[1fr_46px_58px_58px_62px] gap-x-1 bg-obsidian-2/70 px-2 py-1 text-[9.5px] uppercase tracking-[0.08em] text-ink-faint">
          <span>exit</span>
          <span className="text-right">n</span>
          <span className="text-right">n/N</span>
          <span className="text-right">|P±χ|²</span>
          <span className="text-right">dev</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.key}
            className={cx(
              'grid grid-cols-[1fr_46px_58px_58px_62px] gap-x-1 border-t border-hairline/60 px-2 py-1 font-mono text-[10.5px]',
              r.absorbed ? 'text-solar' : 'text-ink-dim',
            )}
          >
            <span className={cx(r.absorbed ? '' : 'text-ink')}>
              {r.absorbed ? 'absorbed at a plug' : `${r.title} (${m.stages.map((s) => s.kind === 'custom' ? 'n̂' : s.kind).join('·')})`}
            </span>
            <span className="text-right">{r.count}</span>
            <span className="text-right">{(100 * r.emp).toFixed(2)}%</span>
            <span className="text-right">{(100 * r.theory).toFixed(2)}%</span>
            <span
              className={cx(
                'text-right',
                Math.abs(r.z) < 2 ? 'text-quantum' : Math.abs(r.z) < 3 ? 'text-ink-dim' : 'text-solar',
              )}
              title={`1σ = ${(100 * r.sigma).toFixed(2)} pp`}
            >
              {r.z.toFixed(2)}σ
            </span>
          </div>
        ))}
      </div>

      <SectionTitle
        right={
          <span
            className={cx(
              'font-mono text-[10.5px]',
              !Number.isFinite(ratio) ? 'text-ink-faint' : Math.abs(ratio - 1) < 1.5 ? 'text-quantum' : 'text-solar',
            )}
          >
            {n > 0 ? `χ²/dof = ${ratio.toFixed(3)}` : '—'}
          </span>
        }
      >
        Goodness of fit
      </SectionTitle>
      <div className="rounded-lg border border-hairline bg-obsidian-2/60 px-2 py-2 text-[11.5px] text-ink-dim">
        <Tex
          tex={
            n > 0
              ? `\\chi^2=\\sum_c \\frac{(n_c-Np_c)^2}{Np_c}=${chi2.toFixed(3)},\\quad \\nu=${dof},\\quad \\max|z|=${maxZ.toFixed(2)}`
              : `p_c=\\lVert P_{c}\\cdots P_1\\chi\\rVert^2`
          }
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          {n > 0
            ? `Total variation distance ${(100 * tvd).toFixed(2)} pp between the dealt beam and the theory, Σp = ${sumP.toFixed(6)} and Σn = ${sumN}/${n} — every atom is accounted for. χ²/dof ≈ 1 means the deviations are pure shot noise; the agreement tightens as 1/√N, so quadrupling “Atoms fired” cuts each σ in half.`
            : 'Probabilities are the squared norms of the projected spinors; fire atoms to compare them with counts.'}
        </p>
        {m.larmorMT > 0 && pStr(params, 'render', 'both') !== 'beam' ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
            Counts follow the live display phase ({(360 * turns).toFixed(1)}°), so with a guide field on the
            histogram breathes at the Larmor rate — that is precession read out as population, not drift.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <PillButton
          tone="accent"
          onClick={() => setParams(slug, { reroll: !pBool(params, 'reroll', false) })}
          title="Clear the running counter on the bench and deal a fresh set of atoms"
        >
          re-deal beam
        </PillButton>
        <PillButton
          onClick={() => setParams(slug, { seed: (seed % 999) + 1 })}
          title="Next mulberry32 seed — a different, still reproducible, noise realisation"
        >
          new seed
        </PillButton>
        <PillButton onClick={() => bump(4)} title="Four times as many atoms: σ → σ/2">
          ×4 atoms
        </PillButton>
        <PillButton onClick={() => bump(0.25)} title="Fewer atoms, so the shot noise becomes obvious">
          ÷4 atoms
        </PillButton>
        <PillButton active={m.render === 'beam'} onClick={() => setParams(slug, { render: 'beam' })}>
          bench
        </PillButton>
        <PillButton active={m.render === 'bloch'} onClick={() => setParams(slug, { render: 'bloch' })}>
          sphere
        </PillButton>
        <PillButton active={m.render === 'both'} onClick={() => setParams(slug, { render: 'both' })}>
          both
        </PillButton>
      </div>
    </div>
  );
}

export default BeamStatsPanel;
