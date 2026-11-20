/**
 * Uncertainty Forge (Sim 10) — module definition.
 *
 * Two canvases coupled by a radix-2 FFT: ψ(x) and φ(p) = F[ψ], with a Heisenberg
 * gauge computed from the exact second moments of whatever is on screen. The
 * gauge only lights up within 0.5 % of the ħ/2 floor, which is what makes the
 * Gaussian's uniqueness something you can *see* rather than read.
 */

import type { SimModule } from '@/simulations/types';
import uncertaintyDefaults from './defaults';
import ForgeCanvas from './ForgeCanvas';
import GaugeTab from './GaugeTab';
import { HEISENBERG_FLOOR, makeGrid, numParam } from './wavepacket';

const meta: SimModule['meta'] = {
  slug: 'uncertainty-lab',
  order: 10,
  name: 'Uncertainty Forge',
  tagline: 'Fourier duality and the Δx·Δp floor',
  track: 'Wave Equations & Tunneling',
  difficulty: 'Foundations',
  exploreMinutes: 12,
  engine: 'Real-time 1D FFT dual plot',
  accent: '#22d3ee',
  gpu: false,
  description:
    'Two canvases locked together by a radix-2 FFT: squeeze a wavepacket narrower in position and watch its momentum spectrum explode outward, with a live Heisenberg gauge that only turns green at the exact ħ/2 minimum-uncertainty floor.',
  tags: ['Fourier', 'Heisenberg', 'wavepackets'],
  route: '/sim/uncertainty-lab',
};

const controls: SimModule['controls'] = [
  {
    kind: 'select',
    key: 'envelope',
    label: 'Envelope',
    group: 'state',
    options: [
      { value: 'gauss', label: 'Gaussian' },
      { value: 'square', label: 'Top-hat' },
      { value: 'lorentz', label: 'Lorentz' },
      { value: 'custom', label: 'Freehand' },
    ],
    help: 'Only the Gaussian saturates σx·σp = ħ/2. A top-hat needs a sinc² tail, a Lorentzian an exponential one, and freehand needs whatever you draw.',
  },
  {
    kind: 'slider',
    key: 'width',
    label: 'Width σx',
    group: 'state',
    min: 0.06,
    max: 6,
    step: 0.02,
    unit: 'a₀',
    help: 'The knob the whole trade runs through. For a Gaussian σp = ħ/(2σx), so this single number sets both panels.',
  },
  {
    kind: 'slider',
    key: 'chirp',
    label: 'Chirp c',
    group: 'state',
    min: -8,
    max: 8,
    step: 0.1,
    unit: 'ħ/a₀²',
    help: 'Quadratic phase exp(i c x²/2). Leaves |ψ|² alone and inflates σp — the cleanest way to break the floor visually without squeezing.',
  },
  {
    kind: 'slider',
    key: 'tilt',
    label: 'Boost ⟨p⟩',
    group: 'state',
    min: -24,
    max: 24,
    step: 0.25,
    unit: 'ħ/a₀',
    help: 'Linear phase: slides the spectrum without changing its width, so the product is untouched.',
  },
  {
    kind: 'slider',
    key: 'center',
    label: 'Position ⟨x⟩',
    group: 'state',
    min: -10,
    max: 10,
    step: 0.05,
    unit: 'a₀',
    help: 'Displaces the packet. Or drag it directly on the upper canvas.',
  },
  {
    kind: 'select',
    key: 'gridN',
    label: 'Samples N',
    group: 'state',
    options: [
      { value: '512', label: '512' },
      { value: '256', label: '256' },
      { value: '1024', label: '1024' },
      { value: '2048', label: '2048' },
    ],
    help: 'Radix-2 only. More samples shrink Δp = 2π/(N·dx) and let narrower features survive the transform.',
  },
  {
    kind: 'slider',
    key: 'xMax',
    label: 'Half-window',
    group: 'state',
    min: 3,
    max: 40,
    step: 0.5,
    unit: 'a₀',
    help: 'x ∈ [−xMax, +xMax]. Wider windows resolve smaller momenta but coarsen Δx, which clips σp for sharp features.',
  },
  {
    kind: 'toggle',
    key: 'evolve',
    label: 'Propagate in time',
    group: 'state',
    help: 'Applies the exact free-particle kernel e^{−ip²t/2ħ} in momentum space, so the packet disperses and the norm cannot drift.',
  },
  {
    kind: 'slider',
    key: 'substeps',
    label: 'Steps / frame',
    group: 'state',
    min: 1,
    max: 12,
    step: 1,
    help: 'How many propagator calls per animation frame — a clock-rate control, not an accuracy one.',
  },
  {
    kind: 'slider',
    key: 'dt',
    label: 'Time step Δt',
    group: 'state',
    min: 0.0002,
    max: 0.004,
    step: 0.0002,
    unit: 'ħ/Eₕ',
    help: 'The kinetic exponential is exact at any Δt, so this only sets how fast the tour of Hilbert space runs.',
  },
  {
    kind: 'slider',
    key: 'brushSize',
    label: 'Brush radius',
    group: 'plots',
    min: 1,
    max: 40,
    step: 1,
    unit: '% window',
    visibleIf: (p) => p.envelope === 'custom',
    help: 'Gaussian-falloff radius. A soft brush keeps the drawing band-limited, so the transform stays readable.',
  },
  {
    kind: 'select',
    key: 'view',
    label: 'Panels',
    group: 'visuals',
    options: [
      { value: 'both', label: 'Both' },
      { value: 'position', label: 'ψ(x)' },
      { value: 'momentum', label: 'φ(p)' },
    ],
  },
  {
    kind: 'toggle',
    key: 'phaseColor',
    label: 'Phase colouring',
    group: 'visuals',
    help: 'Hue = arg ψ on the shared twilight wheel, extent = |ψ|. Brightness never encodes phase.',
  },
  {
    kind: 'toggle',
    key: 'showPhase',
    label: 'Re ψ / Im ψ traces',
    group: 'visuals',
    help: 'The oscillating components inside the envelope — the part a classical wave would have and a probability amplitude does not.',
  },
  {
    kind: 'toggle',
    key: 'logMagnitude',
    label: 'Log |φ(p)|²',
    group: 'visuals',
    help: 'Sits on a decade scale so the sinc² sidelobes and exponential tails become visible next to the peak.',
  },
  {
    kind: 'toggle',
    key: 'showGauge',
    label: 'Heisenberg gauge',
    group: 'visuals',
    help: 'The bar at the foot of the position panel, driven by the measured second moments.',
  },
];

const pBoolish = (v: unknown): boolean => v === true;

function fmt(n: number, d = 4): string {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

const telemetry: SimModule['telemetry'] = (p) => {
  const g = makeGrid(numParam(p, 'gridN', 512), numParam(p, 'xMax', 12));
  const sigmaX = numParam(p, 'sigmaX', 0);
  const sigmaP = numParam(p, 'sigmaP', 0);
  const product = numParam(p, 'product', 0);
  const sigma = Math.max(0.02, numParam(p, 'width', 0.6));
  const chirp = numParam(p, 'chirp', 0);
  // Closed form, straight from the controls — no round trip through the canvas.
  const analytic = sigma * Math.sqrt(1 / (4 * sigma * sigma) + chirp * chirp * sigma * sigma);
  const norm = numParam(p, 'waveNorm', 0);
  const ratio = product / HEISENBERG_FLOOR;
  const live = norm > 1e-9 && product > 0;
  const onFloor = live && product <= HEISENBERG_FLOOR * 1.005;
  return [
    {
      label: 'σx',
      value: live ? fmt(sigmaX) : '—',
      hint: `⟨x⟩ = ${fmt(numParam(p, 'meanX', 0), 3)}`,
      tone: 'accent',
    },
    {
      label: 'σp',
      value: live ? fmt(sigmaP) : '—',
      hint: `⟨p⟩ = ${fmt(numParam(p, 'meanP', 0), 3)}`,
      tone: 'accent',
    },
    {
      label: 'σx·σp',
      value: live ? fmt(product, 5) : '—',
      hint: `floor ħ/2 = ${HEISENBERG_FLOOR.toFixed(4)}`,
      tone: onFloor ? 'good' : live ? 'warn' : 'default',
    },
    {
      label: 'σxσp / ħ',
      value: live ? fmt(product, 5) : '—',
      hint: 'ħ = 1 in atomic units',
    },
    {
      label: '× floor',
      value: live ? `${fmt(ratio, 4)}×` : '—',
      hint: onFloor ? 'green: minimum uncertainty' : 'above the bound',
      tone: onFloor ? 'good' : 'warn',
    },
    {
      label: 'excess',
      value: live ? fmt(product - HEISENBERG_FLOOR, 5) : '—',
      hint: 'σxσp − ħ/2',
    },
    {
      label: 'analytic σxσp',
      value: fmt(analytic, 5),
      hint: `√(¼ + c²σ⁴), c = ${fmt(numParam(p, 'chirp', 0), 2)}`,
    },
    {
      label: '⟨E⟩ = ⟨p²⟩/2m',
      value: fmt(numParam(p, 'energy', 0), 5),
      hint: 'hartree, mₑ = 1',
    },
    {
      label: '‖ψ‖² (L²)',
      value: fmt(norm, 6),
      hint: 'unitary split-step',
      tone: Math.abs(norm - 1) < 1e-3 ? 'good' : live ? 'warn' : 'default',
    },
    {
      label: 'Δp grid',
      value: fmt(g.dk, 5),
      hint: `N = ${g.N}, Δx = ${fmt(g.dx, 5)}`,
    },
    {
      label: 'p ceiling',
      value: fmt(g.kMax, 3),
      hint: 'π/Δx — aliasing wall',
    },
    {
      label: 'evolved t',
      value: fmt(numParam(p, 'evolveTime', 0), 4),
      hint: pBoolish(p.evolve) ? 'propagating' : 'frozen',
    },
  ];
};

const math: SimModule['math'] = (p) => {
  const g = makeGrid(numParam(p, 'gridN', 512), numParam(p, 'xMax', 12));
  const sigma = Math.max(0.04, numParam(p, 'width', 0.6));
  const c = numParam(p, 'chirp', 0);
  const p0 = numParam(p, 'tilt', 0);
  const analyticP = Math.sqrt(1 / (4 * sigma * sigma) + c * c * sigma * sigma);
  const product = Math.sqrt(0.25 + c * c * sigma * sigma * sigma * sigma);
  const env = typeof p.envelope === 'string' ? p.envelope : 'gauss';
  return {
    formula: [
      {
        tex: '\\phi(p) = \\frac{1}{\\sqrt{2\\pi\\hbar}}\\int_{-\\infty}^{\\infty}\\psi(x)\\,e^{-ipx/\\hbar}\\,dx,\\qquad \\psi(x) = \\frac{1}{\\sqrt{2\\pi\\hbar}}\\int \\phi(p)\\,e^{+ipx/\\hbar}\\,dp',
        display: true,
        note: 'The Fourier pair the two panels are: the lower one is not a plot of a second quantity, it is the same state re-expressed in the momentum basis.',
      },
      {
        tex: '\\sigma_A^2 = \\langle A^2\\rangle - \\langle A\\rangle^2,\\qquad \\sigma_A\\sigma_B \\ge \\tfrac12\\big|\\langle[\\hat A,\\hat B]\\rangle\\big| \\xrightarrow{\\;[\\hat x,\\hat p]=i\\hbar\\;} \\frac{\\hbar}{2}',
        display: true,
        note: 'Robertson’s inequality with the commutator evaluated, then strengthened by Schrödinger’s covariance term. The gauge reads its left-hand side from the discrete second moments, never from an assumed shape.',
      },
      {
        tex: '\\psi(x)\\propto\\exp\\!\\Big[-\\frac{(x-x_0)^2}{4\\sigma^2} + i\\Big(\\tfrac{1}{2}cx^2 + p_0x\\Big)\\Big] \\;\\Longrightarrow\\; \\sigma_x\\sigma_p = \\hbar\\sqrt{\\tfrac14 + \\frac{c^2\\sigma^4}{\\hbar^2}}',
        display: true,
        note: 'Equality at c = 0: the Gaussian is the unique minimiser. A chirp lifts the product without touching |ψ(x)|² at all.',
      },
      {
        tex: '\\sigma_x(t) = \\sigma_{x0}\\sqrt{1 + \\Big(\\frac{\\hbar t}{2\\sigma_{x0}^2 m}\\Big)^2} = \\frac{\\hbar}{2\\sigma_x(0)}\\sqrt{\\Big(\\frac{\\hbar t}{m}\\Big)^2 + 4\\sigma_{x0}^4}',
        display: true,
        note: 'Exact free spreading of a Gaussian, which also proves it stays a minimum-uncertainty state for all time.',
      },
    ],
    readout: [
      { label: 'grid', value: `N = ${g.N}, Δx = ${fmt(g.dx, 5)}` },
      { label: 'Δp = 2π/(NΔx)', value: fmt(g.dk, 5) },
      { label: 'p ceiling π/Δx', value: fmt(g.kMax, 3) },
      { label: 'envelope', value: env },
      { label: 'σ (requested)', value: fmt(sigma, 4) },
      { label: 'chirp c', value: fmt(c, 3) },
      { label: '⟨p⟩ from tilt', value: fmt(p0, 3) },
      { label: 'analytic σp', value: fmt(analyticP, 5) },
      { label: 'analytic σxσp', value: fmt(product, 5) },
      { label: 'floor ħ/2', value: HEISENBERG_FLOOR.toFixed(5) },
      { label: 'σx measured', value: numParam(p, 'sigmaX', 0) > 0 ? fmt(numParam(p, 'sigmaX', 0), 5) : 'pending' },
      { label: 'σp measured', value: numParam(p, 'sigmaP', 0) > 0 ? fmt(numParam(p, 'sigmaP', 0), 5) : 'pending' },
    ],
    phaseLegend:
      'The upper panel paints hue = arg ψ on the twilight wheel and extent = |ψ(x)|, so a bulge is real probability and a colour cycle is a phase winding — the two are never conflated. The lower panel is a single violet trace of |φ(p)|², its ±σx band mirrored as a ±σp band, with the dashed amber curve being the closed-form Gaussian |φ|² for the same σ and chirp. The bar at the foot is the Heisenberg gauge: green only inside 0.5 % of ħ/2, amber to 25 % above, rose beyond that.',
    intuition:
      'The uncertainty relation is not a statement about clumsy measurement — it is a theorem about **pairs of Fourier transforms**. A state that is confined to a small patch of x cannot be built from a narrow band of momenta, because a narrow band of plane waves has a long wavelength and therefore a long memory in x. Everything the forge shows follows from that single fact:\n\n- **Shape decides the floor.** Squeeze a Gaussian and σp grows by exactly the reciprocal amount, so the product sits on ħ/2 at every width. Change the envelope to a top-hat and the product leaves the floor at once: a discontinuity carries a sinc² tail.\n- **Phase is momentum.** A linear phase slides the spectrum (⟨p⟩ moves, σp does not). A *quadratic* phase — chirp — does something subtler: |ψ(x)|² is untouched, so σx cannot change, yet σp inflates because the local wavelength varies across the packet. That is the one way to break the product without touching the position distribution.\n- **Free evolution is chirp accumulation.** Release the packet and the exact kernel e^{−ip²t/2ħ} is itself a quadratic phase in x, so σx grows as σx₀√(1 + (t/2σx₀²)²) while σp stays pinned. Narrow packets spread fastest — which is the same inequality read forwards in time.',
    derivation: [
      {
        title: 'From two moments to the floor',
        steps: [
          {
            text: 'Define the spread of any observable by its centred second moment. For the two operators at hand, with the state normalised,',
            math: [
              {
                tex: '\\sigma_x^2 = \\langle\\psi|(\\hat x - \\langle x\\rangle)^2|\\psi\\rangle,\\qquad \\sigma_p^2 = \\langle\\psi|(\\hat p - \\langle p\\rangle)^2|\\psi\\rangle',
                display: true,
              },
            ],
            note: 'The forge computes exactly these two sums over the grid — no Gaussian assumption anywhere in the gauge.',
          },
          {
            text: 'Introduce the two Hermitian "deviation" operators and apply the Cauchy–Schwarz inequality to the states A|ψ⟩ and B|ψ⟩:',
            math: [
              { tex: '\\hat A = \\hat x - \\langle x\\rangle,\\quad \\hat B = \\hat p - \\langle p\\rangle,\\qquad \\|\\hat A\\psi\\|^2\\,\\|\\hat B\\psi\\|^2 \\ge \\big|\\langle \\hat A\\psi|\\hat B\\psi\\rangle\\big|^2', display: true },
            ],
          },
          {
            text: 'A modulus dominates its own imaginary part, so keep only the antisymmetric piece of the product — the symmetric piece is the Schrödinger correlation term and can only help:',
            math: [
              { tex: '\\big|\\langle \\hat A\\psi|\\hat B\\psi\\rangle\\big| \\;\\ge\\; \\big|\\mathrm{Im}\\,\\langle \\hat A\\psi|\\hat B\\psi\\rangle\\big| \\;=\\; \\tfrac12\\big|\\langle[\\hat A,\\hat B]\\rangle\\big| \\;=\\; \\frac{\\hbar}{2}', display: true },
            ],
            note: '[x̂, p̂] = iħ survives translation, so the commutator of the deviations is the same c-number.',
          },
          {
            text: 'Combining the two lines gives the Robertson bound — and it is a theorem about the state, not about any apparatus:',
            math: [{ tex: '\\sigma_x\\sigma_p \\ge \\frac{\\hbar}{2}', display: true }],
          },
          {
            text: 'Parseval is what makes the left-hand side computable from *either* panel alone: the Fourier map is unitary, so ‖ψ‖² = ‖φ‖² and ⟨p²⟩ read from the spectrum equals ⟨ψ|p̂²|ψ⟩ read from −ħ²ψ″. In the code that is one radix-2 FFT with the scaling dx/√(2π), which is exactly why Σ|φ|²Δp reproduces Σ|ψ|²Δx to machine precision.',
          },
          {
            text: 'Equality needs Cauchy–Schwarz to be tight, i.e. B|ψ⟩ = iλA|ψ⟩ for a real λ. That first-order ODE integrates to a Gaussian of width fixed by λ, and the two moments then multiply to exactly the bound:',
            math: [
              {
                tex: '\\psi\\propto\\exp\\!\\Big[-\\frac{\\lambda}{2\\hbar}(x-x_0)^2 + \\frac{i}{\\hbar}p_0x\\Big],\\qquad \\sigma_x^2 = \\frac{\\hbar}{\\lambda},\\quad \\sigma_p^2 = \\frac{\\hbar\\lambda}{4}\\;\\Rightarrow\\;\\sigma_x\\sigma_p = \\frac{\\hbar}{2}',
                display: true,
              },
            ],
            note: 'The minimiser is unique up to translation and boost: the gauge is green for Gaussians and for nothing else.',
          },
        ],
      },
      {
        title: 'Why chirp broadens momentum but not position',
        steps: [
          {
            text: 'Write the state the forge actually builds, with ħ = m = 1:',
            math: [{ tex: '\\psi(x) = \\Big(2\\pi\\sigma^2\\Big)^{-1/4}\\exp\\!\\Big[-\\frac{x^2}{4\\sigma^2}\\Big]\\exp\\!\\Big[i\\Big(\\tfrac12 c x^2 + p_0 x\\Big)\\Big]', display: true }],
          },
          {
            text: 'The modulus is the first exponential alone, so the position moments are unaffected by c:',
            math: [{ tex: '\\sigma_x = \\sigma,\\qquad \\langle x\\rangle = x_0', display: true }],
          },
          {
            text: 'Momentum acts as −i∂ₓ, so writing ψ = A(x)e^{iS(x)} with S = cx²/2 + p₀x gives p̂ψ = (S′ − iA′/A)ψ and hence |p̂ψ|² = [(S′)² + (A′/A)²]A². With A′/A = −x/(2σ²) the two pieces add in quadrature:',
            math: [
              { tex: '\\langle p\\rangle = p_0,\\qquad \\langle \\hat p^2\\rangle = \\langle(p_0 + cx)^2\\rangle + \\frac{\\langle x^2\\rangle}{4\\sigma^4} = p_0^2 + c^2\\sigma^2 + \\frac{1}{4\\sigma^2}', display: true },
            ],
            note: 'The interference term is p₀c⟨x⟩ = 0 about the packet centre, so real chirp and amplitude curvature contribute independently. This is the exact expression the amber dashed overlay is drawn from.',
          },
          {
            text: 'Multiplying gives the trade-off curve the audit tab plots, and it makes the asymmetry explicit: the penalty is c²σ⁴, so *wide* chirped packets are hurt hardest, and the covariance is Cov = cσ².',
            math: [
              { tex: '(\\sigma_x\\sigma_p)^2 = \\tfrac14 + c^2\\sigma^4 = \\tfrac{\\hbar^2}{4} + \\text{Cov}^2,\\qquad \\text{excess} = \\sigma_x\\sigma_p - \\tfrac{\\hbar}{2}', display: true },
            ],
            note: 'That is the Schrödinger–Robertson refinement: the Gaussian never leaves ħ²/4 + Cov², it just acquires covariance.',
          },
          {
            text: 'Free evolution is a shear in phase space — x̂(t) = x̂(0) + t·p̂(0) with ħ = m = 1 — so both the chirp and the amplitude curvature keep spreading the bump, with the determinant σx²σp² − Cov² pinned at ħ²/4 the whole way:',
            math: [
              {
                tex: '\\sigma_x(t) = \\sqrt{\\sigma^2(1 + ct)^2 + \\frac{t^2}{4\\sigma^2}} \\;\\xrightarrow{\\;c=0\\;}\\; \\sigma\\sqrt{1 + \\Big(\\frac{t}{2\\sigma^2}\\Big)^2},\\qquad \\sigma_p(t) = \\sigma_p(0)',
                display: true,
              },
            ],
            note: 'The audit tab compares this closed form against the mirrored σx at the current t — they agree to FFT round-off, because the kinetic exponential is the exact propagator rather than an approximation of one.',
          },
        ],
      },
    ],
    challenge: [
      {
        question:
          'Squeeze σx from 3 to 0.2 without ever leaving the green band, then switch to the top-hat at the same width. Why does the gauge go red instantly even though ψ(x) barely changed?',
        hint: 'The gauge reads σp from the spectrum. Look at what a discontinuity costs in |φ(p)|², and switch on the log magnitude to see it.',
        answer:
          'A Gaussian stays at σxσp = ħ/2 for every σx because its transform is a Gaussian of reciprocal width. A top-hat has jump discontinuities, and a jump needs the whole momentum axis: |φ| ∝ sinc(pΔx/ħ) with sidelobes decaying only as 1/p, so ⟨p²⟩ is dominated by the truncation ceiling π/Δx. The product blows up while σx stays put — the extra spread is entirely a phase/shape effect.',
        paramKey: 'envelope',
      },
      {
        question:
          'Find the chirp c that makes a σx = 1 packet exactly 3× the floor, without changing σx at all, then predict ⟨E⟩ before you read it off.',
        hint: 'Solve √(¼ + c²σ⁴) = 3·½ with σ = 1. Then remember ⟨E⟩ = ⟨p²⟩/2m = (σp² + ⟨p⟩²)/2 with m = 1.',
        answer:
          'c = √(9/4 − 1/4) = √2 ≈ 1.414 for σx = 1. σp = 1.5 exactly while σx = 1 by construction, so the packet gets no narrower. ⟨E⟩ = (σp² + ⟨p⟩²)/2 = 1.125 + ⟨p⟩²/2 with ⟨p⟩ = tilt — which is the whole point: chirp stores kinetic energy in position-dependent phase, not in a tighter bump.',
        paramKey: 'chirp',
      },
    ],
  };
};

const demos: SimModule['demos'] = [
  {
    id: 'uc-squeeze',
    label: 'Squeeze the packet',
    summary:
      'Run σx from 2.6 down to 0.32 and watch the spectrum widen by exactly the reciprocal amount while the gauge never leaves the floor — then switch envelopes and fall off it.',
    durationSec: 46,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          envelope: 'gauss',
          width: 2.6,
          chirp: 0,
          tilt: 0,
          center: 0,
          view: 'both',
          evolve: false,
          logMagnitude: false,
          showGauge: true,
        },
        caption: 'A wide Gaussian: σp is tiny, so the spectrum is a needle. The gauge already reads exactly ħ/2.',
      },
      {
        at: 9,
        params: { width: 1.2 },
        caption: 'Squeeze it. The lower panel spreads by the reciprocal factor and the product does not budge.',
      },
      {
        at: 20,
        params: { width: 0.5 },
        caption: 'σx = 0.5 ⇒ σp = 1/(2σx) = 1.0 exactly. Green is not luck, it is the unique minimiser.',
      },
      {
        at: 28,
        instant: true,
        params: { width: 0.32, logMagnitude: true },
        caption: 'Hard squeeze with a log vertical: the Gaussian tails fall off a cliff. That is why ⟨p²⟩ stays finite.',
      },
      {
        at: 34,
        instant: true,
        params: { envelope: 'square' },
        caption: 'Same width, top-hat. Two jump discontinuities ⇒ sinc² sidelobes ⇒ the product jumps off the floor.',
      },
      {
        at: 40,
        instant: true,
        params: { envelope: 'lorentz', logMagnitude: false },
        caption: 'Lorentzian: |φ| decays like e^(−|p|w/ħ) — better than a jump, worse than a Gaussian. Still above the floor.',
      },
    ],
  },
  {
    id: 'uc-chirp',
    label: 'Chirp without squeezing',
    summary:
      'Break the uncertainty product while leaving |ψ(x)|² completely frozen, by adding a quadratic phase — then release the packet and watch the same mechanism appear as free dispersion.',
    durationSec: 52,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          envelope: 'gauss',
          width: 1.1,
          chirp: 0,
          tilt: 0,
          center: 0,
          view: 'both',
          evolve: false,
          logMagnitude: false,
        },
        caption: 'Start on the floor: σx = 1.1, σp = 1/(2·1.1), product 0.5000.',
      },
      {
        at: 8,
        params: { chirp: 3 },
        caption: 'Ramp the chirp. σx is *identical* — only the phase changed — yet σp inflates and the gauge goes amber, then rose.',
      },
      {
        at: 18,
        instant: true,
        params: { tilt: 7 },
        caption: 'Add a linear phase on top: the whole spectrum slides, ⟨p⟩ = 7, and σp is exactly what it was. Shape, not shift.',
      },
      {
        at: 26,
        instant: true,
        params: { chirp: 0, tilt: 0, evolve: true },
        caption: 'Now chirp off and propagation on. The kinetic kernel e^(−ip²t/2) is itself a quadratic phase in x.',
      },
      {
        at: 38,
        params: {},
        caption: 'The packet spreads, σp does not move, and the audit tab confirms σx(t) = σ₀√(1 + (t/2σ₀²)²) to FFT round-off.',
      },
      {
        at: 44,
        instant: true,
        params: { width: 0.4, view: 'position' },
        caption: 'Narrow it and release: spreading time 2σ₀² shrinks quadratically, so the tightest packets disperse fastest.',
      },
    ],
  },
];

const describe: SimModule['describe'] = (p) => {
  const product = numParam(p, 'product', 0);
  const norm = numParam(p, 'waveNorm', 0);
  const ratio = product / HEISENBERG_FLOOR;
  const env = typeof p.envelope === 'string' ? p.envelope : 'gauss';
  return `σx=${fmt(numParam(p, 'sigmaX', 0), 3)} · σp=${fmt(numParam(p, 'sigmaP', 0), 3)} · ${
    norm > 1e-9 ? `${fmt(ratio, 3)}× ħ/2` : 'measuring…'
  } · ${env}${pBoolish(p.evolve) ? ` · t=${fmt(numParam(p, 'evolveTime', 0), 2)}` : ''}`;
};

const simModule: SimModule = {
  meta,
  defaultParams: uncertaintyDefaults,
  controls,
  Canvas: ForgeCanvas,
  extraTabs: [{ id: 'gauge', label: 'Heisenberg', glyph: '⊼', Component: GaugeTab }],
  telemetry,
  math,
  demos,
  describe,
};

export default simModule;
