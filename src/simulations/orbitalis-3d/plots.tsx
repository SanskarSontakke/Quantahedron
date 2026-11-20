'use client';

/**
 * Orbitalis 3D — inspector panels.
 *
 * `MixPanel` is the interactive superposition editor: the shared phasor matrix
 * (drag out for |c|, drag around for arg c) plus one-tap orbital presets.
 * `PlotsPanel` is the chart gallery: exact radial and angular distributions, the
 * energy ladder with field-corrected levels, the hydrogen line series, and the
 * live detector histograms that the measurement engine accumulates.
 *
 * Every curve is computed from the analytic hydrogenic solution — no fitted or
 * decorative data anywhere.
 */

import { useEffect, useMemo, useState } from 'react';
import type { SimParams, SimSlug } from '@/simulations/types';
import { pArr, pBool, pNum, pStr, useSimParams, useSimStore } from '@/store/useSimStore';
import {
  angularDistribution,
  energyHa,
  radialDistribution,
  radialNodes,
  rExpectation,
  rMostProbable,
} from '@/engine/physics/hydrogen';
import {
  BOHR_MAGNETON_EV_PER_T,
  MAX_N,
  HARTREE_EV,
  SUBSHELL_LETTERS,
  transitionWavelengthNm,
  wavelengthToRGB,
} from '@/engine/physics/constants';
import { PlotCanvas, label, plotFrame, plotGrid } from '@/components/ui/PlotCanvas';
import { PillButton, SectionTitle, Segmented, Slider, cx } from '@/components/ui/controls';
import { PhasorMatrix, type PhasorBasisCell } from '@/components/stage/PhasorMatrix';
import { ORBITAL_PRESETS, MAX_SLOTS, presetToAmps } from './state';
import { collapseCounts, detector, radialSeries, RADIAL_BINS, resetDetector } from './stats';

const SERIES: { value: string; label: string }[] = [
  { value: 'lyman', label: 'Lyman (n′=1)' },
  { value: 'balmer', label: 'Balmer (n′=2)' },
  { value: 'paschen', label: 'Paschen (n′=3)' },
];

const SLOT_COLORS = ['#5eead4', '#a78bfa', '#fbbf24', '#f472b6'];

/* ------------------------------ mix panel -------------------------------- */

export function MixPanel({ slug }: { slug: SimSlug }) {
  const params = useSimParams(slug);
  const setParams = useSimStore((s) => s.setParams);
  const interruptDemo = useSimStore((s) => s.interruptDemo);

  const basis = pStr(params, 'basis', 'complex');
  const Z = Math.max(1, Math.round(pNum(params, 'Z', 1)));
  const mPref = Math.round(pNum(params, 'm', 0));
  const ns = pArr(params, 'ampsN');
  const ls = pArr(params, 'ampsL');
  const ms = pArr(params, 'ampsM');
  const amps = pArr(params, 'ampsAmp');

  // The offered basis cells follow the m-slider: pick m = −1 and the grid becomes
  // the m = −1 ladder, so phase-winding choices are one tap away.
  const cells = useMemo<PhasorBasisCell[]>(() => {
    const out: PhasorBasisCell[] = [];
    for (let n = 1; n <= Math.min(5, MAX_N); n++) {
      for (let l = 0; l <= Math.min(n - 1, 3); l++) {
        const m = Math.max(-l, Math.min(l, mPref));
        out.push({ n, l, m, label: m === 0 ? `${n}${SUBSHELL_LETTERS[l]}` : `${n}${SUBSHELL_LETTERS[l]}·m${m}` });
      }
    }
    return out;
  }, [mPref]);

  const applyPreset = (id: string) => {
    const preset = ORBITAL_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const list = presetToAmps(preset, basis === 'hybrid' ? 'complex' : basis);
    setParams(slug, {
      n: preset.n,
      l: preset.l,
      m: preset.m,
      ampsN: list.map((a) => a.n),
      ampsL: list.map((a) => a.l),
      ampsM: list.map((a) => a.m),
      ampsAmp: list.map((a) => a.amp),
      ampsPhase: list.map((a) => a.phase),
      basis: basis === 'hybrid' ? 'real' : basis,
    });
    interruptDemo();
  };

  const total = amps.reduce((s, a) => s + a * a, 0);

  return (
    <div className="flex flex-col gap-3">
      <PhasorMatrix
        slug={slug}
        nKey="ampsN"
        lKey="ampsL"
        mKey="ampsM"
        ampKey="ampsAmp"
        phaseKey="ampsPhase"
        cells={cells}
        maxSlots={MAX_SLOTS}
        title="Σ cₖ|n ℓ m⟩"
        onInteract={interruptDemo}
      />

      <div>
        <SectionTitle>Quick states</SectionTitle>
        <div className="flex flex-wrap gap-1">
          {ORBITAL_PRESETS.map((p) => {
            const on =
              ns.length > 0 && Math.round(ns[0]) === p.n && Math.round(ls[0]) === p.l && Math.round(ms[0]) === p.m;
            return (
              <PillButton key={p.id} active={on} onClick={() => applyPreset(p.id)} title={p.latex}>
                {p.label}
              </PillButton>
            );
          })}
        </div>
      </div>

      <div>
        <SectionTitle>Named superpositions</SectionTitle>
        <div className="flex flex-col gap-1.5">
          <PillButton
            onClick={() => {
              setParams(slug, {
                basis: 'complex',
                n: 2,
                l: 0,
                m: 0,
                ampsN: [1, 2],
                ampsL: [0, 1],
                ampsM: [0, 0],
                ampsAmp: [0.7071, 0.7071],
                ampsPhase: [0, 0],
              });
              interruptDemo();
            }}
          >
            1s + 2p₀ cat state — the oscillating dipole
          </PillButton>
          <PillButton
            onClick={() => {
              setParams(slug, {
                basis: 'complex',
                n: 3,
                l: 1,
                m: 1,
                ampsN: [2, 2],
                ampsL: [1, 1],
                ampsM: [1, -1],
                ampsAmp: [0.7071, 0.7071],
                ampsPhase: [0, 1.5708],
              });
              interruptDemo();
            }}
          >
            p₊ + ip₋ circulating current
          </PillButton>
          <PillButton
            onClick={() => {
              setParams(slug, {
                basis: 'complex',
                n: 3,
                l: 0,
                m: 0,
                ampsN: [1, 2, 3, 4],
                ampsL: [0, 1, 2, 3],
                ampsM: [0, 1, 2, 3],
                ampsAmp: [0.5, 0.5, 0.5, 0.5],
                ampsPhase: [0, 0.4, 0.8, 1.2],
              });
              interruptDemo();
            }}
          >
            Four-shell wave-packet
          </PillButton>
        </div>
      </div>

      <p className="text-[10.5px] leading-relaxed text-ink-faint">
        Σ|c|² = {total.toFixed(3)}{Math.abs(total - 1) > 0.01 ? ' — use Normalise so the Born rule holds' : ' · normalised'}.
        Z = {Z} contracts every radius by 1/Z and deepens each level by Z².
      </p>
    </div>
  );
}

/* ------------------------------ plots panel ------------------------------ */

export function PlotsPanel({ slug }: { slug: SimSlug }) {
  const params = useSimParams(slug);
  const setParam = useSimStore((s) => s.setParam);
  const interruptDemo = useSimStore((s) => s.interruptDemo);
  const measure = pBool(params, 'measure', false);

  // Poll the detector tally; the drawer unmounts this tab when collapsed, so the
  // interval only runs while the learner is actually looking at the histograms.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => (t + 1) % 1024), 260);
    return () => window.clearInterval(id);
  }, []);

  const Z = Math.max(0.4, pNum(params, 'Z', 1));
  const ns = pArr(params, 'ampsN');
  const ls = pArr(params, 'ampsL');
  const ms = pArr(params, 'ampsM');
  const as = pArr(params, 'ampsAmp');
  const active = useMemo(
    () =>
      as
        .map((a, i) => ({ a, n: Math.round(ns[i] ?? 1), l: Math.round(ls[i] ?? 0), m: Math.round(ms[i] ?? 0) }))
        .filter((s) => s.a > 1e-4)
        .slice(0, MAX_SLOTS),
    [as, ns, ls, ms],
  );

  /* ---- radial distribution 4πr²|R|², weighted by |c|² ---- */
  const radial = useMemo(() => {
    const rmax = Math.max(...active.map((s) => (14 * s.n * s.n) / Z), 18);
    const curves = active.map((s, i) => ({
      ...radialDistribution(s.n, s.l, Z, 200, rmax),
      weight: s.a * s.a,
      color: SLOT_COLORS[i % SLOT_COLORS.length],
    }));
    return { curves, rmax };
  }, [active, Z]);

  const drawRadial = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const pad = { l: 6, r: 6, t: 8, b: 14 };
    plotGrid(ctx, w, h, pad, 3, 5);
    plotFrame(ctx, w, h, pad);
    for (const c of radial.curves) {
      const norm = Math.max(...c.p, 1e-9);
      ctx.strokeStyle = c.color;
      ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, c.weight * 2);
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      for (let i = 0; i < c.r.length; i++) {
        const x = pad.l + ((w - pad.l - pad.r) * c.r[i]) / radial.rmax;
        const y = h - pad.b - (h - pad.t - pad.b) * (c.p[i] / norm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    label(ctx, `r (a₀) · 0 → ${radial.rmax.toFixed(0)}`, pad.l + 2, h - 4);
    label(ctx, 'P(r) = 4πr²|R|²', w - 96, 10, 'rgba(148,163,184,0.6)');
  };

  /* ---- angular polar plot |Y_l^m(θ,0)|² ---- */
  const ang = useMemo(() => {
    const focus = active[0] ?? { n: 1, l: 0, m: 0, a: 1 };
    return { ...angularDistribution(focus.l, focus.m, 181), n: focus.n, l: focus.l, m: focus.m };
  }, [active]);

  const drawAngular = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const cxp = w / 2;
    const cyp = h / 2;
    const R = Math.min(w, h) / 2 - 10;
    ctx.strokeStyle = 'rgba(148,163,184,0.16)';
    ctx.lineWidth = 1;
    for (const f of [0.34, 0.67, 1]) {
      ctx.beginPath();
      ctx.arc(cxp, cyp, R * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cxp, cyp - R);
    ctx.lineTo(cxp, cyp + R);
    ctx.stroke();
    const peak = Math.max(ang.max, 1e-9);
    ctx.strokeStyle = SLOT_COLORS[1];
    ctx.lineWidth = 1.8;
    ctx.fillStyle = 'rgba(167,139,250,0.22)';
    ctx.beginPath();
    for (let i = 0; i < ang.theta.length; i++) {
      const rr = R * Math.sqrt(ang.a[i] / peak);
      const x = cxp + rr * Math.sin(ang.theta[i]);
      const y = cyp - rr * Math.cos(ang.theta[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = ang.theta.length - 1; i >= 0; i--) {
      const rr = R * Math.sqrt(ang.a[i] / peak);
      const x = cxp - rr * Math.sin(ang.theta[i]);
      const y = cyp - rr * Math.cos(ang.theta[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    label(ctx, `|Y_${ang.l}^${ang.m}|²`, 6, 11, 'rgba(148,163,184,0.7)');
    label(ctx, 'θ = 0 ↑', cxp + 4, 10, 'rgba(148,163,184,0.5)');
  };

  /* ---- energy ladder ---- */
  const nTop = Math.min(MAX_N, Math.max(...active.map((s) => s.n), 1) + 2);
  const drawLadder = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const pad = { l: 26, r: 8, t: 10, b: 14 };
    const e0 = energyHa(1, Z) * HARTREE_EV;
    const eTop = 0.02;
    const yFor = (eHa: number) => {
      const e = eHa * HARTREE_EV;
      return pad.t + ((h - pad.t - pad.b) * (eTop - e)) / (eTop - e0);
    };
    ctx.strokeStyle = 'rgba(148,163,184,0.14)';
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.stroke();
    for (let n = 1; n <= nTop; n++) {
      const e = energyHa(n, Z);
      const y = yFor(e);
      const occupied = active.some((s) => s.n === n);
      ctx.strokeStyle = occupied ? SLOT_COLORS[(active.findIndex((s) => s.n === n) + SLOT_COLORS.length) % SLOT_COLORS.length] : 'rgba(148,163,184,0.4)';
      ctx.lineWidth = occupied ? 2 : 1;
      const x0 = pad.l + 6 + ((w - pad.l - pad.r) * (n - 1)) / nTop;
      const x1 = x0 + (w - pad.l - pad.r) / nTop - 12;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      // m-sublevels, split only when a B field is on.
      const B = pNum(params, 'zeemanB', 0);
      if (B > 0 && occupied) {
        for (let dm = -1; dm <= 1; dm += 2) {
            const dy = ((dm * 2 * B * BOHR_MAGNETON_EV_PER_T) / Math.max(1e-6, -e0)) * (h - pad.t - pad.b);
            ctx.strokeStyle = 'rgba(251,191,36,0.75)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x0 + 2, y + dy);
            ctx.lineTo(x1 - 2, y + dy);
            ctx.stroke();
        }
      }
      label(ctx, `n${n}`, x0, h - 4, 'rgba(148,163,184,0.65)', 9);
    }
    label(ctx, `${e0.toFixed(1)} eV`, 2, h - pad.b - 1, 'rgba(148,163,184,0.7)', 8.5);
    label(ctx, '0', 12, pad.t + 6, 'rgba(148,163,184,0.7)', 8.5);
  };

  /* ---- line series ---- */
  const series = pStr(params, 'series', 'balmer');
  const lower = series === 'lyman' ? 1 : series === 'balmer' ? 2 : 3;
  const hiMax = Math.min(MAX_N, Math.max(lower + 1, Math.round(pNum(params, 'transitionHi', 3))));
  const lines = useMemo(() => {
    const out: { from: number; nm: number; rgb: string; ev: number }[] = [];
    for (let n = lower + 1; n <= hiMax + 3; n++) {
      const nm = transitionWavelengthNm(n, lower, 1);
      const rgb = wavelengthToRGB(nm);
      out.push({
        from: n,
        nm,
        ev: 1239.841984 / nm,
        rgb: `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`,
      });
    }
    return out;
  }, [lower, hiMax]);

  const drawLines = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const pad = { l: 8, r: 8, t: 10, b: 16 };
    const nmMax = Math.max(...lines.map((l) => l.nm), 1);
    for (const l of lines) {
      const x = pad.l + ((w - pad.l - pad.r) * l.nm) / nmMax;
      ctx.strokeStyle = l.rgb;
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, h - pad.b);
      ctx.stroke();
      ctx.globalAlpha = 1;
      label(ctx, `${l.from}→${lower}`, Math.min(x + 3, w - 34), pad.t + 10, 'rgba(148,163,184,0.75)', 8.5);
    }
    label(ctx, `λ up to ${nmMax.toFixed(0)} nm`, pad.l, h - 5, 'rgba(148,163,184,0.7)', 9);
  };

  /* ---- detector histogram ---- */
  const hist = radialSeries();
  const drawDetector = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const pad = { l: 6, r: 6, t: 8, b: 14 };
    plotFrame(ctx, w, h, pad);
    const bw = (w - pad.l - pad.r) / RADIAL_BINS;
    for (let i = 0; i < RADIAL_BINS; i++) {
      const v = hist[i];
      if (v <= 0) continue;
      const bh = (h - pad.t - pad.b) * v;
      ctx.fillStyle = 'rgba(94,234,212,0.75)';
      ctx.fillRect(pad.l + i * bw, h - pad.b - bh, Math.max(1, bw - 1), bh);
    }
    const focus = active[0];
    if (focus) {
      const rcut = (14 * focus.n * focus.n) / Z;
      const cur = radialDistribution(focus.n, focus.l, Z, 160, rcut);
      const norm = Math.max(...cur.p, 1e-9);
      ctx.strokeStyle = 'rgba(251,191,36,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < cur.r.length; i++) {
        const x = pad.l + ((w - pad.l - pad.r) * cur.r[i]) / rcut;
        const y = h - pad.b - (h - pad.t - pad.b) * (cur.p[i] / norm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      label(ctx, `theory P(r) to ${rcut.toFixed(0)} a₀`, pad.l + 2, h - 4, 'rgba(251,191,36,0.7)', 8.5);
    }
  };

  const tally = collapseCounts();
  const tallyTotal = tally.reduce((s, [, c]) => s + c, 0);

  return (
    <div className="flex flex-col gap-3 pb-1">
      <div>
        <SectionTitle>Radial distribution</SectionTitle>
        <PlotCanvas height={132} draw={drawRadial} deps={[radial]} />
        <p className="mt-1 text-[10px] leading-snug text-ink-faint">
          One curve per active eigenstate, scaled by |c|². ⟨r⟩ = {(active.length ? active.reduce((sum, s) => sum + s.a * s.a * rExpectation(s.n, s.l, Z), 0) / Math.max(1e-9, active.reduce((sum, s) => sum + s.a * s.a, 0)) : 0).toFixed(2)} a₀,
          r* = {(active.length ? rMostProbable(active[0].n, active[0].l, Z) : 0).toFixed(2)} a₀ for {active.length ? `${active[0].n}${SUBSHELL_LETTERS[Math.min(active[0].l, 6)]}` : '—'} with {active.length ? radialNodes(active[0].n, active[0].l) : 0} radial nodes.
        </p>
      </div>

      <div>
        <SectionTitle>Angular shape</SectionTitle>
        <PlotCanvas height={150} draw={drawAngular} deps={[ang]} />
      </div>

      <div>
        <SectionTitle>Energy ladder</SectionTitle>
        <PlotCanvas height={132} draw={drawLadder} deps={[active, Z, pNum(params, 'zeemanB', 0), nTop]} />
      </div>

      <div>
        <SectionTitle>Emission series</SectionTitle>
        <Segmented
          label="Series"
          value={series}
          options={SERIES}
          onChange={(v) => {
            setParam(slug, 'series', v);
            interruptDemo();
          }}
        />
        <Slider
          label="Upper level n′"
          value={hiMax}
          min={lower + 1}
          max={MAX_N}
          step={1}
          onInteract={interruptDemo}
          onChange={(v) => setParam(slug, 'transitionHi', v)}
        />
        <PlotCanvas height={92} draw={drawLines} deps={[lines, series, hiMax]} />
        <p className="mt-1 text-[10px] leading-snug text-ink-faint">
          {lines.length ? `${lines[lines.length - 1].from}→${lower} = ${lines[lines.length - 1].nm.toFixed(1)} nm (${lines[lines.length - 1].ev.toFixed(3)} eV)` : ''}
          {lower === 1 ? ' · Lyman is vacuum-UV' : lower === 2 ? ' · Balmer is the visible series' : ' · Paschen is infrared'}
        </p>
      </div>

      <div>
        <SectionTitle>Detector statistics</SectionTitle>
        <div className="mb-1.5 flex items-center gap-2">
          <span className={cx('h-1.5 w-1.5 rounded-full', detector.total > 0 ? 'bg-flux' : 'bg-ink-faint')} />
          <span className="text-[10.5px] text-ink-dim">
            {detector.total.toLocaleString('en-US')} position clicks
          </span>
          <PillButton onClick={() => { resetDetector(); setTick((t) => t + 1); }}>clear</PillButton>
        </div>
        {detector.total > 0 ? (
          <PlotCanvas height={112} draw={drawDetector} deps={[detector.version]} />
        ) : (
          <p className="text-[10.5px] leading-snug text-ink-faint">
            {measure ? 'Accumulating — the histogram fills as clicks arrive.' : 'Switch on "Fire the detector" in the Fields tab to build |Ψ|² one click at a time.'}
          </p>
        )}
        {tally.length > 0 ? (
          <table className="mt-2 w-full text-[10.5px]">
            <thead>
              <tr className="text-ink-faint">
                <th className="text-left font-normal">found</th>
                <th className="text-right font-normal">count</th>
                <th className="text-right font-normal">predicted</th>
              </tr>
            </thead>
            <tbody>
              {tally.slice(0, 6).map(([key, count]) => {
                const [n, l, m] = key.split(',').map(Number);
                const want = active.find((s) => s.n === n && s.l === l && s.m === m);
                const norm = Math.max(1e-9, active.reduce((sum, s) => sum + s.a * s.a, 0));
                const p = want ? (want.a * want.a) / norm : 0;
                return (
                  <tr key={key} className="text-ink-dim">
                    <td>{n}{SUBSHELL_LETTERS[Math.min(l, 6)]}{m === 0 ? '' : `(m${m > 0 ? '+' : ''}${m})`}</td>
                    <td className="text-right">{count}</td>
                    <td className="text-right">{(100 * p).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {tallyTotal > 0 ? (
          <p className="mt-1 text-[10px] text-ink-faint">
            {tallyTotal} energy collapses tallied against the Born-rule prediction |c|²/Σ|c|².
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function describeOrbitalis(p: SimParams): string {
  const amps = pArr(p, 'ampsAmp');
  const ns = pArr(p, 'ampsN');
  const ls = pArr(p, 'ampsL');
  if (amps.length <= 1) {
    return `Pure ${ns[0] ?? 1}${SUBSHELL_LETTERS[Math.min(ls[0] ?? 0, 6)]} orbital`;
  }
  return `${amps.length}-state superposition of ${ns.map((n, i) => `${Math.round(n)}${SUBSHELL_LETTERS[Math.min(Math.round(ls[i] ?? 0), 6)]}`).join(' + ')}`;
}
