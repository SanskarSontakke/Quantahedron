/**
 * 2D Double-Slit Interferometer (Sim 5) — module definition.
 *
 * Real-time 2D TDSE on a WebGL2 float ping-pong with a CPU Float32Array
 * fallback, a phosphor detector that accumulates individual electron hits, and a
 * which-path marker whose ±φ coin washes the fringes into the classical
 * two-hump distribution.
 */

import type { SimModule } from '@/simulations/types';
import doubleSlitDefaults from './defaults';
import FieldCanvas from './FieldCanvas';
import DetectorTab from './DetectorTab';
import { pNum } from '@/store/useSimStore';
import { SCREEN_X, buildConfig, numParam, requestGridRes } from './solver';

const meta: SimModule['meta'] = {
  slug: 'double-slit-2d',
  order: 5,
  name: '2D Double-Slit',
  tagline: 'Wavepacket interference and which-path decoherence',
  track: 'Wave Equations & Tunneling',
  difficulty: 'Advanced',
  exploreMinutes: 20,
  engine: 'WebGL2 GPU RK4 shader',
  accent: '#a78bfa',
  gpu: true,
  description:
    'A real-time 2D Schrödinger solver running on ping-pong float framebuffers with a fourth-order Runge–Kutta Laplacian stencil, a phosphor detector screen accumulating single-electron hits, and a which-path detector that wipes the fringes away.',
  tags: ['interference', 'GPU', 'measurement', 'complementarity'],
  route: '/sim/double-slit-2d',
};

const controls: SimModule['controls'] = [
  {
    kind: 'slider',
    key: 'separation',
    label: 'Slit separation d',
    group: 'state',
    min: 0.04,
    max: 0.4,
    step: 0.005,
    help: 'Centre-to-centre distance of the two apertures, in domain units. Δy = λL/d scales linearly with it.',
  },
  {
    kind: 'slider',
    key: 'slitWidth',
    label: 'Slit width w',
    group: 'state',
    min: 0.006,
    max: 0.12,
    step: 0.002,
    help: 'Each aperture acts as its own single-slit source: the sinc² envelope narrows as w grows.',
  },
  {
    kind: 'slider',
    key: 'barrierX',
    label: 'Barrier position',
    group: 'state',
    min: 0.14,
    max: 0.72,
    step: 0.005,
    help: 'Sets the propagation distance L = x_screen − x_barrier, so it changes the fringe spacing too.',
  },
  {
    kind: 'slider',
    key: 'barrierThickness',
    label: 'Barrier thickness',
    group: 'state',
    min: 0.006,
    max: 0.09,
    step: 0.001,
    help: 'Opaque slab of potential V = 2 ħ²/a² — thick enough to be class-impossible, thin enough to tunnel a whisper through.',
  },
  {
    kind: 'slider',
    key: 'momentum',
    label: 'Momentum p',
    group: 'state',
    min: 90,
    max: 420,
    step: 5,
    help: 'De Broglie wavelength λ = 2π/p. Higher p ⇒ shorter λ ⇒ finer fringes and a faster crossing.',
  },
  {
    kind: 'slider',
    key: 'packetY',
    label: 'Aim height',
    group: 'state',
    min: 0.14,
    max: 0.86,
    step: 0.005,
    help: 'Where the beam is aimed. Off-centre aiming starves one slit and the fringes fade as the two amplitudes stop matching.',
  },
  {
    kind: 'slider',
    key: 'packetSigma',
    label: 'Packet width σ',
    group: 'state',
    min: 0.02,
    max: 0.14,
    step: 0.005,
    help: 'Transverse width of the emitted wavefront. Narrower means a cleaner two-slit illumination but worse momentum resolution.',
  },
  {
    kind: 'select',
    key: 'gridRes',
    label: 'Lattice N×N',
    group: 'state',
    options: [
      { value: '512', label: '512²' },
      { value: '384', label: '384²' },
      { value: '256', label: '256²' },
    ],
    help: 'Cells per side. The CPU fallback always runs at reduced resolution.',
  },
  {
    kind: 'slider',
    key: 'substeps',
    label: 'Substeps / frame',
    group: 'state',
    min: 1,
    max: 8,
    step: 1,
    help: 'RK4 steps taken per animation frame at nominal speed. The step size itself is fixed by the CFL bound.',
  },
  {
    kind: 'slider',
    key: 'timeScale',
    label: 'Beam speed ×',
    group: 'state',
    min: 0.2,
    max: 4,
    step: 0.1,
    help: 'Multiplies substeps to set how fast the packet crosses. Physics is unchanged: the integrator always runs at its stable Δt.',
  },
  {
    kind: 'toggle',
    key: 'singleElectron',
    label: 'One electron at a time',
    group: 'state',
    help: 'Fire discrete packets and let the screen record clicks. Off = a single wide packet, i.e. the classical continuous wave.',
  },
  {
    kind: 'slider',
    key: 'emissionRate',
    label: 'Emission rate',
    group: 'plots',
    min: 1,
    max: 60,
    step: 1,
    unit: 'e⁻/s',
    help: 'Packets injected per second of wall time (Poisson-distributed).',
  },
  {
    kind: 'slider',
    key: 'screenBins',
    label: 'Screen bins',
    group: 'plots',
    min: 48,
    max: 320,
    step: 4,
    help: 'Resolution of the accumulated phosphor histogram, which is what the permalink stores.',
  },
  {
    kind: 'toggle',
    key: 'accumulate',
    label: 'Accumulate hits',
    group: 'plots',
    help: 'Keep the latent image. Switch off to watch only the instantaneous |ψ|² profile.',
  },
  {
    kind: 'toggle',
    key: 'whichPath',
    label: 'Which-path detector',
    group: 'fields',
    help: 'Give every electron a random ±φ phase mark on the whole arm feeding one slit — a path record that could in principle be read.',
  },
  {
    kind: 'select',
    key: 'whichPathSlit',
    label: 'Marked aperture',
    group: 'fields',
    options: [
      { value: '0', label: 'Upper' },
      { value: '1', label: 'Lower' },
    ],
    visibleIf: (p) => p.whichPath === true,
  },
  {
    kind: 'slider',
    key: 'decoherence',
    label: 'Path information δ',
    group: 'fields',
    min: 0,
    max: 1,
    step: 0.02,
    visibleIf: (p) => p.whichPath === true,
    help: 'φ = (π/2)·δ. Predicted visibility |cos φ|, predicted distinguishability |sin φ| — and the screen agrees.',
  },
  {
    kind: 'select',
    key: 'view',
    label: 'View',
    group: 'visuals',
    options: [
      { value: 'field', label: 'Field' },
      { value: 'both', label: 'Field + screen' },
      { value: 'screen', label: 'Screen' },
    ],
  },
  {
    kind: 'slider',
    key: 'contrast',
    label: 'Field exposure',
    group: 'visuals',
    min: 0.2,
    max: 4,
    step: 0.05,
    help: 'Inside the logarithmic tone map, so faint diffraction orders come up without blowing out the bright core.',
  },
  {
    kind: 'toggle',
    key: 'phaseColor',
    label: 'Phase colouring',
    group: 'visuals',
    help: 'Hue = arg ψ on the twilight wheel, luminance = |ψ|². Density never drives hue.',
  },
  {
    kind: 'toggle',
    key: 'showBarrier',
    label: 'Show barrier',
    group: 'visuals',
  },
];

function fmt(n: number, d = 4): string {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

const telemetry: SimModule['telemetry'] = (p) => {
  const cfg = buildConfig(p, requestGridRes(p));
  const L = SCREEN_X - cfg.barrierX;
  const dy = (cfg.lambda * L) / cfg.sep;
  const measured = pNum(p, 'measuredV', 0);
  const fringe = pNum(p, 'fringe', 0);
  const hits = Math.round(pNum(p, 'hits', 0));
  const packets = Math.round(pNum(p, 'packets', 0));
  const phi = (Math.PI / 2) * numParam(p, 'decoherence', 1);
  const vTheory = Math.abs(Math.cos(phi));
  const dTheory = Math.abs(Math.sin(phi));
  const on = p.whichPath === true;
  return [
    { label: 'λ = 2π/p', value: fmt(cfg.lambda), hint: 'domain units' },
    { label: 'd / λ', value: fmt(cfg.sep / cfg.lambda, 1), hint: 'fringes inside the envelope' },
    { label: 'Δy = λL/d', value: fmt(dy), hint: `L = ${fmt(L, 3)}` },
    {
      label: 'Δy measured',
      value: fringe > 0 ? fmt(fringe) : 'building…',
      hint: 'from the accumulated hits',
      tone: fringe > 0 ? 'accent' : 'default',
    },
    {
      label: 'Visibility V',
      value: fmt(measured, 3),
      hint: on ? `theory |cos φ| = ${fmt(vTheory, 3)}` : '(Imax−Imin)/(Imax+Imin)',
      tone: on && measured < vTheory * 0.6 ? 'warn' : 'good',
    },
    {
      label: 'V² + D²',
      value: fmt(measured * measured + dTheory * dTheory, 3),
      hint: on ? '≤ 1, saturated at equality' : 'detector off ⇒ D = 0',
      tone: 'accent',
    },
    { label: 'Hits on screen', value: String(hits), hint: `${packets} electrons fired` },
    {
      label: '‖ψ‖² (lattice)',
      value: fmt(pNum(p, 'fieldNorm', 0), 3),
      hint: 'Σ|ψ|² — 1.000 per electron in flight',
      tone: pNum(p, 'fieldNorm', 0) > 1.02 || pNum(p, 'fieldNorm', 0) < 0.2 ? 'warn' : 'good',
    },
    {
      label: 'Solver',
      value: typeof p.engineLabel === 'string' && p.engineLabel ? p.engineLabel : 'starting…',
      hint: `Δt(4+V₀) = 2.5 → ${fmt(cfg.dt, 3)}`,
    },
  ];
};

const math: SimModule['math'] = (p) => {
  const cfg = buildConfig(p, requestGridRes(p));
  const L = SCREEN_X - cfg.barrierX;
  const dy = (cfg.lambda * L) / cfg.sep;
  const phi = (Math.PI / 2) * numParam(p, 'decoherence', 1);
  const on = p.whichPath === true;
  return {
    formula: [
      {
        tex: 'i\\hbar\\,\\partial_t\\psi = -\\frac{\\hbar^2}{2m}\\nabla^2\\psi + V(\\mathbf r)\\psi',
        display: true,
        note: 'Time-dependent Schrödinger equation in two dimensions, with V = 2 inside the barrier and 0 in vacuum.',
      },
      {
        tex: '\\psi^{n+1} = \\Big(1 + z + \\tfrac{z^2}{2} + \\tfrac{z^3}{6} + \\tfrac{z^4}{24}\\Big)\\psi^{n},\\qquad z = -\\,i\\,\\Delta t\\,\\hat H',
        display: true,
        note: 'Exact update to O(Δt⁵): RK4 on a *linear* operator is just the truncated exponential, evaluated by Horner factorisation in four stencil passes.',
      },
      {
        tex: 'd\\sin\\theta = m\\lambda,\\qquad \\Delta y = \\frac{\\lambda L}{d}',
        display: true,
        note: 'Constructive interference between the two apertures, and the resulting fringe spacing on the detector.',
      },
      {
        tex: 'V^2 + D^2 \\le 1',
        display: true,
        note: 'Englert–Greenberger–Yasinov complementarity bound: path knowledge and fringe visibility trade off exactly.',
      },
    ],
    readout: [
      { label: 'λ = 2π/p', value: fmt(cfg.lambda) },
      { label: 'slit separation d', value: fmt(cfg.sep, 3) },
      { label: 'slit width w', value: fmt(cfg.slitW, 3) },
      { label: 'far distance L', value: fmt(L, 3) },
      { label: 'Δy predicted', value: fmt(dy) },
      { label: 'Δy measured', value: pNum(p, 'fringe', 0) > 0 ? fmt(pNum(p, 'fringe', 0)) : 'accumulating' },
      { label: 'lattice Δt', value: fmt(cfg.dt, 3) },
      { label: 'N × N cells', value: `${cfg.N}` },
      { label: 'detector mark φ', value: on ? fmt(phi, 3) : 'off' },
      { label: 'V / D predicted', value: on ? `${fmt(Math.abs(Math.cos(phi)), 3)} / ${fmt(Math.abs(Math.sin(phi)), 3)}` : '1 / 0' },
    ],
    phaseLegend:
      'Hue is arg ψ on the shared twilight wheel — a wavefront sliding through the slits cycles hue while keeping its brightness. Luminance is |ψ|² only, so a bright band always means real probability, never a phase artefact. On the screen panel teal is the accumulated histogram, indigo the instantaneous |ψ|², amber dashes the d sinθ = mλ prediction.',
    intuition:
      'Fire electrons one at a time and each one lands as a **single dot** — the detector never sees half an electron. Nothing about a lone hit suggests a wave. But after a few hundred dots the bands appear, exactly where $d\\sin\\theta = m\\lambda$ puts them, so the *probability distribution* is wavelike while the *event* is particle-like. In this solver that is not an add-on postulate: the field is a genuine complex wave obeying the 2D TDSE, and the dots are drawn from $|\\psi|^2$ at the detector line, one Poisson-distributed click at a time.\n\nThe which-path detector makes the trade visible. Marking one aperture with a random $\\pm\\varphi$ phase — the back-action of a path marker that *could* be read — leaves the two arms less mutually coherent, and the accumulated pattern slides from sharp fringes towards the incoherent sum of two single-slit diffraction peaks. Turn the marker up and the fringes go; turn it back down (a quantum eraser) and the *next* electrons restore them, because nothing was destroyed, only recorded.',
    derivation: [
      {
        title: 'From the stencil to the screen',
        steps: [
          {
            text: 'Discretise the Laplacian on an N×N cell lattice with ħ = mₑ = 1 and spacing dx = 1 cell, so the discrete Hamiltonian acting on cell c is',
            math: [
              {
                tex: "(\\hat H\\psi)_c = -\\tfrac14\\!\\!\\sum_{c'\\sim c}\\!\\psi_{c'} + \\big(\\tfrac12 + V_c\\big)\\psi_c",
                display: true,
              },
            ],
          },
          {
            text: 'Because Ĥ is linear, the four classical RK4 stages collapse into one polynomial in z = −iΔt Ĥ. Written in Horner form it needs only a read of the previous stage plus a read of ψ⁰:',
            math: [
              {
                tex: 'P = I + z\\Big(I + \\tfrac{z}{2}\\Big(I + \\tfrac{z}{3}\\big(I + \\tfrac{z}{4}\\big)\\Big)\\Big)',
                display: true,
              },
            ],
          },
          {
            text: 'Each factor is one fragment pass of the shape out = ψ⁰ + c·(−iĤ)(in) with c = Δt/4, Δt/3, Δt/2, Δt, so three float textures rotate through the roles ψ⁰ / scratch / scratch and a full step costs no copies at all.',
          },
          {
            text: 'RK4 damps high-frequency noise while keeping low-k modes accurate: |R(iy)| ≤ 1 for |y| ≤ 2√2 and |R(iy)| < 1 beyond y ≈ 1.5. With the kinetic band edge of −½∇² equal to 4 in 2D and a barrier step V = 2, the stable step used here is',
            math: [{ tex: `\\Delta t = \\frac{2.5}{4 + V} = ${fmt(cfg.dt, 4)}`, display: true }],
          },
          {
            text: 'Open boundaries are a complex absorbing potential −iW(uv) on the right, top and bottom edges, applied as exp(−WΔt) on the final pass only. Since it multiplies by a factor of modulus < 1 it is unconditionally stable however strong W is — that is what keeps the diffracted cones readable instead of ringing.',
          },
          {
            text: `The detector line reads density and the x-current Im(ψ*∂ₓψ) along x = ${SCREEN_X}. Integrating the positive current over the lattice time advanced gives the expected number of arrivals this frame, so the click train is earned by the solver rather than scripted.`,
          },
        ],
      },
      {
        title: 'Why path information destroys fringes',
        steps: [
          {
            text: 'Write the transmitted field as the sum of the two aperture contributions, with the marked arm carrying a per-electron phase:',
            math: [{ tex: '\\psi = \\psi_0 + e^{i\\sigma\\varphi}\\psi_1,\\qquad \\sigma = \\pm 1', display: true }],
          },
          {
            text: 'The screen records',
            math: [
              {
                tex: '|\\psi|^2 = |\\psi_0|^2 + |\\psi_1|^2 + 2\\,\\mathrm{Re}\\big(\\psi_0^{*}\\psi_1\\,e^{i\\sigma\\varphi}\\big)',
                display: true,
              },
            ],
          },
          {
            text: 'Averaging over the coin — which is what doing the experiment many times means — the cross term acquires the factor ⟨e^{±iφ}⟩ = cos φ while the two incoherent terms are untouched. The accumulated pattern therefore has visibility',
            math: [{ tex: 'V = \\frac{I_{\\max}-I_{\\min}}{I_{\\max}+I_{\\min}} = |\\cos\\varphi|', display: true }],
          },
          {
            text: 'The same marker states that carry the phase are perfectly distinguishable when read, with overlap cos φ, so the path knowledge is',
            math: [{ tex: `D = \\sqrt{1-\\cos^2\\varphi} = |\\sin\\varphi|,\\qquad \\varphi = \\tfrac{\\pi}{2}\\delta = ${fmt(phi, 3)}`, display: true }],
          },
          {
            text: 'Hence V² + D² = 1 exactly: the bound is saturated, not approximated. δ = 0 leaves the arms coherent (V = 1, D = 0) and δ = 1 makes them perfectly distinguishable (V = 0, D = 1), so the screen tends to the incoherent sum of the two single-slit patterns — two broad humps with the fine structure averaged away. In the solver the measured number bottoms out at a few tenths instead of exactly zero, because the accumulated line also carries a weak modulation that the ± mark cannot touch and the mixture therefore leaves behind.',
          },
          {
            text: 'Fringe spacing follows from the path difference: constructive interference needs d sinθ = mλ, so with the detector at distance L the bands sit Δy = λL/d apart — here',
            math: [
              {
                tex: `\\Delta y = \\frac{2\\pi}{p}\\frac{L}{d} = ${fmt(dy, 4)}`,
                display: true,
                note: 'Compare with the value measured from the accumulated hits in the telemetry.',
              },
            ],
          },
        ],
      },
    ],
    challenge: [
      {
        question:
          'Set the detector somewhere in the middle (δ = 0.5) and let a few hundred electrons land. What visibility should the screen show, and does the measured one agree?',
        hint: 'φ = (π/2)·δ, and the ± coin leaves coherence cos φ — so V = |cos(π/4)| = 1/√2 before you look at the histogram.',
        answer:
          'V should sit at ≈ 0.707 and V² + D² at 1. The measured value converges to it as hits accumulate; small-sample noise is Poisson, so double the hits to halve the relative scatter.',
        paramKey: 'decoherence',
      },
      {
        question:
          'Find a (p, d) pair where exactly five bright fringes fit inside the central diffraction envelope, then predict the spacing before you measure it.',
        hint:
          'The envelope first null is at sinθ = λ/w and the m-th fringe at sinθ = mλ/d, so the number inside is about 2d/w. Use Δy = λL/d to convert to screen units.',
        answer:
          'The count depends only on d/w (here d/w ≈ ' +
          fmt(cfg.sep / cfg.slitW, 1) +
          '), not on λ: changing p rescales the whole pattern but not the number of fringes. Halving p doubles Δy.',
        paramKey: 'separation',
      },
    ],
  };
};

const demos: SimModule['demos'] = [
  {
    id: 'ds-single-electrons',
    label: 'Single electrons build interference',
    summary:
      'Fire the gun one electron at a time, watch individual dots accumulate, then retune λ and d and see Δy = λL/d hold exactly.',
    durationSec: 52,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          view: 'both',
          singleElectron: true,
          whichPath: false,
          decoherence: 0,
          accumulate: true,
          emissionRate: 26,
          screenBins: 220,
          momentum: 210,
          separation: 0.16,
          slitWidth: 0.028,
          packetY: 0.5,
          contrast: 1.15,
        },
        caption: 'One electron at a time. Each hit is a dot — the wave is in the statistics.',
      },
      {
        at: 12,
        params: { view: 'screen' },
        caption: 'Accumulated hits vs d·sinθ = mλ: the theory curve is not fitted, it is predicted from p, d and w.',
      },
      {
        at: 22,
        params: { momentum: 150 },
        caption: 'Soften the beam: λ = 2π/p grows, so Δy = λL/d grows with it. Fringes spread out.',
      },
      {
        at: 32,
        params: { momentum: 210, separation: 0.28 },
        caption: 'Now widen the slit spacing d: the fringes crowd together, still exactly λL/d apart.',
      },
      {
        at: 42,
        params: { separation: 0.16, slitWidth: 0.07 },
        caption: 'Wider apertures pinch the sinc² envelope — the outer fringes disappear, the inner ones stay put.',
      },
      {
        at: 50,
        params: { slitWidth: 0.028, view: 'both' },
        caption: 'Back to the canonical geometry. The pattern is a property of the wave, not of the electrons.',
      },
    ],
  },
  {
    id: 'ds-which-path',
    label: 'Which-path collapse',
    summary:
      'Build a crisp interference pattern, then mark one slit per electron and watch V fall to |cos φ| while the histogram turns into the classical two-hump sum.',
    durationSec: 60,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          view: 'both',
          singleElectron: true,
          whichPath: false,
          decoherence: 0,
          accumulate: true,
          emissionRate: 34,
          screenBins: 240,
          momentum: 190,
          separation: 0.18,
          slitWidth: 0.026,
          contrast: 1.1,
        },
        caption: 'Detector off: both apertures are fed by one coherent wavefront, so V → 1.',
      },
      {
        at: 14,
        instant: true,
        params: { whichPath: true, decoherence: 0.45 },
        caption: 'Detector on, halfway: φ = (π/2)·δ ⇒ the prediction is V = |cos φ| ≈ 0.71. Keep collecting.',
      },
      {
        at: 26,
        params: { view: 'screen' },
        caption: 'The amber prediction curve stays pinned to the data while the fringe depth drops.',
      },
      {
        at: 34,
        instant: true,
        params: { decoherence: 1 },
        caption: 'Full path information: φ = π/2, so V = 0 and D = 1 — V² + D² = 1, saturated.',
      },
      {
        at: 46,
        params: {},
        caption: 'What remains is the incoherent sum of two single-slit diffraction patterns: no dark bands at all.',
      },
      {
        at: 52,
        instant: true,
        params: { whichPath: false, decoherence: 0 },
        caption: 'Eraser: switch the marker off and the next electrons restore full visibility. Nothing was destroyed.',
      },
    ],
  },
];

const describe: SimModule['describe'] = (p) => {
  const cfg = buildConfig(p, requestGridRes(p));
  const hits = Math.round(pNum(p, 'hits', 0));
  const L = SCREEN_X - cfg.barrierX;
  return `λ=${fmt(cfg.lambda, 3)} · d=${fmt(cfg.sep, 2)} · Δy=${fmt((cfg.lambda * L) / cfg.sep, 3)} · ${
    p.whichPath === true ? `which-path δ=${fmt(numParam(p, 'decoherence', 1), 2)}` : 'coherent'
  } · ${hits} hits`;
};

const simModule: SimModule = {
  meta,
  defaultParams: doubleSlitDefaults,
  controls,
  Canvas: FieldCanvas,
  extraTabs: [
    { id: 'detector', label: 'Which-path', glyph: '⌖', Component: DetectorTab },
  ],
  telemetry,
  math,
  demos,
  describe,
};

export default simModule;
