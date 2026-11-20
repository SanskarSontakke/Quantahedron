/**
 * Sim 3 — inspector control spec.
 *
 * Three tabs, deliberately ordered the way a lecture builds the problem: the
 * Hamiltonian (State), what you look at (Visuals), and the numerics that make the
 * answer trustworthy (Fields). Every key exists in `defaults.ts`, so any stage
 * state can be pasted into a permalink.
 */

import type { ControlSpec, SimParams } from '@/simulations/types';
import { pNum, pStr } from '@/store/useSimStore';
import { BRUSH_SAMPLES, POTENTIALS, TDSE_VIEWS, gridNOf } from './model';

const isDouble = (p: SimParams): boolean => pStr(p, 'potential', 'double') === 'double';
const isKronig = (p: SimParams): boolean => pStr(p, 'potential', 'double') === 'kronig';
const isCustom = (p: SimParams): boolean => pStr(p, 'potential', 'double') === 'custom';
const hasSponge = (p: SimParams): boolean => pNum(p, 'capWidth', 0.06) > 0;

export const isComplexView = (p: SimParams): boolean => pStr(p, 'view', 'density') === 'reim';

const VIEWS = TDSE_VIEWS.map((v) => ({
  value: v,
  label: v === 'density' ? '|ψ(x,t)|²' : v === 'reim' ? 'Re ψ / Im ψ' : v === 'spectrum' ? 'eigen spectrum' : 'absorbing sponge',
}));

export const tdseControls: ControlSpec[] = [
  /* --------------------------------- state --------------------------------- */
  {
    kind: 'select',
    key: 'potential',
    label: 'Potential V(x)',
    group: 'state',
    options: POTENTIALS.map((o) => ({ value: o.value, label: o.label })),
    help: 'Every choice is diagonalised exactly as drawn: the spectrum you see is the spectrum of the operator the propagator applies.',
  },
  {
    kind: 'slider',
    key: 'V0',
    label: 'Well / wall depth',
    group: 'state',
    min: 0.5,
    max: 40,
    step: 0.25,
    unit: 'a.u.',
    visibleIf: (p) => !isKronig(p),
    help: 'Depth of the finite/double well and the paint height of the brush. The infinite well ignores it (its walls are fixed at 2000 a.u.).',
  },
  {
    kind: 'slider',
    key: 'wellWidth',
    label: 'Well width',
    group: 'state',
    min: 0.06,
    max: 0.96,
    step: 0.01,
    help: 'Fraction of the box the flat-bottomed region occupies.',
    format: (v) => `${(v * 100).toFixed(0)} %`,
  },
  {
    kind: 'slider',
    key: 'barrierGap',
    label: 'Central barrier',
    group: 'state',
    min: 0.01,
    max: 0.5,
    step: 0.005,
    visibleIf: isDouble,
    help: 'Width of the insulating wall between the two wells. Tunnel splitting scales like e^(−2κ·gap) — halve it and the splitting grows enormously.',
    format: (v) => `${(v * 100).toFixed(1)} %`,
  },
  {
    kind: 'slider',
    key: 'asymmetry',
    label: 'Well asymmetry',
    group: 'state',
    min: -1,
    max: 1,
    step: 0.02,
    visibleIf: isDouble,
    help: 'Raises the right-hand well floor by asymmetry·V0. At |asymmetry| > 0 the levels stop coming in near-degenerate pairs and tunneling stalls (energy resonance is lost).',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'kronigPeriods',
    label: 'Lattice periods',
    group: 'state',
    min: 1,
    max: 16,
    step: 1,
    visibleIf: isKronig,
    help: 'Number of Kronig–Penney cells across the box. Each cell splits into a band of (periods) levels — watch the gaps open.',
    format: (v) => `${Math.round(v)}`,
  },
  {
    kind: 'slider',
    key: 'latticeDepth',
    label: 'Lattice depth',
    group: 'state',
    min: 0,
    max: 30,
    step: 0.5,
    unit: 'a.u.',
    visibleIf: isKronig,
    help: 'Barrier height between cells. Deeper lattices narrow the bands and widen the gaps.',
  },
  {
    kind: 'slider',
    key: 'x0',
    label: 'Packet centre x₀',
    group: 'state',
    min: 0.02,
    max: 0.98,
    step: 0.005,
    help: 'Re-launches ψ from t = 0.',
    format: (v) => `${(v * 100).toFixed(0)} %`,
  },
  {
    kind: 'slider',
    key: 'sigma',
    label: 'Packet width σₓ',
    group: 'state',
    min: 0.01,
    max: 0.3,
    step: 0.005,
    help: 'Initial position spread as a fraction of the box. Narrow packets carry a wide momentum band and therefore disperse fastest: σ(t) = σ₀√(1 + (t/2σ₀²)²).',
    format: (v) => `${(v * 100).toFixed(1)} %`,
  },
  {
    kind: 'slider',
    key: 'k0',
    label: 'Wavenumber k₀',
    group: 'state',
    min: -140,
    max: 140,
    step: 1,
    help: 'Mean momentum p = ℏk with k = k0/15, so k0 = 60 means E = 8 a.u. — exactly the default barrier depth.',
    format: (v) => `${Math.round(v)}`,
  },
  {
    kind: 'slider',
    key: 'packetAmp',
    label: 'Initial norm ‖ψ‖',
    group: 'state',
    min: 0.05,
    max: 3,
    step: 0.05,
    help: 'The state is normalised to ‖ψ‖² = 1 by construction and then scaled, so you can watch a “partial particle”. Crank–Nicolson is linear: every expectation value except the norm is unchanged.',
    format: (v) => v.toFixed(2),
  },

  /* -------------------------------- visuals -------------------------------- */
  {
    kind: 'select',
    key: 'view',
    label: 'View  (keys 1–4)',
    group: 'visuals',
    options: VIEWS,
    help: 'Density, the raw complex field, the eigenstate occupation chart, or the absorbing-sponge diagnostic.',
  },
  {
    kind: 'toggle',
    key: 'showPotential',
    label: 'V(x) skyline',
    group: 'visuals',
  },
  {
    kind: 'toggle',
    key: 'showEigen',
    label: 'Eigen ladder overlay',
    group: 'visuals',
    help: 'Dashed lines at each diagonalised Eₖ, thickened by |⟨φₖ|ψ⟩|². Costs one tridiagonal diagonalisation whenever V(x) changes (off the UI thread).',
  },
  {
    kind: 'slider',
    key: 'eigenCount',
    label: 'Levels solved',
    group: 'visuals',
    min: 2,
    max: 32,
    step: 1,
    help: 'How many eigenpairs of H are extracted by Sturm bisection + inverse iteration.',
    format: (v) => `${Math.round(v)}`,
  },
  {
    kind: 'toggle',
    key: 'colorPhase',
    label: 'Phase colouring',
    group: 'visuals',
    visibleIf: (p) => !isComplexView(p),
    help: 'arg ψ → hue, |ψ|² → brightness, so a travelling packet shows a moving rainbow.',
  },
  {
    kind: 'toggle',
    key: 'logDensity',
    label: 'Log density ramp',
    group: 'visuals',
    help: 'Compresses ten decades of |ψ|² into the plot height — the only way to see tunneling tails next to the packet.',
  },
  {
    kind: 'toggle',
    key: 'showReal',
    label: 'Re ψ curve',
    group: 'visuals',
    visibleIf: isComplexView,
  },
  {
    kind: 'toggle',
    key: 'showImag',
    label: 'Im ψ curve',
    group: 'visuals',
    visibleIf: isComplexView,
  },
  {
    kind: 'slider',
    key: 'yScale',
    label: 'Vertical exposure',
    group: 'visuals',
    min: 0.2,
    max: 4,
    step: 0.05,
    format: (v) => `×${v.toFixed(2)}`,
  },

  /* --------------------------------- fields -------------------------------- */
  {
    kind: 'slider',
    key: 'gridN',
    label: 'Grid points N',
    group: 'fields',
    min: 128,
    max: 1024,
    step: 128,
    help: 'Cell count across the 15 a.u. box. The work per frame is O(N) — a Thomas sweep, no matrix, no iteration.',
    format: (v) => `${Math.round(v)}`,
  },
  {
    kind: 'slider',
    key: 'dt',
    label: 'Time step Δt',
    group: 'fields',
    min: 0.00005,
    max: 0.008,
    step: 0.00005,
    unit: 'a.u.',
    help: 'Crank–Nicolson is unconditionally stable, so this only buys wall-clock speed: accuracy needs Δt·E ≪ 1 on the *occupied* levels (see the telemetry row), not on the empty top of the lattice band.',
    format: (v) => v.toFixed(5),
  },
  {
    kind: 'slider',
    key: 'stepsPerFrame',
    label: 'Steps / frame',
    group: 'fields',
    min: 1,
    max: 24,
    step: 1,
    help: 'Physical time advance per rendered frame = stepsPerFrame·Δt.',
    format: (v) => `${Math.round(v)}`,
  },
  {
    kind: 'slider',
    key: 'capWidth',
    label: 'Sponge width',
    group: 'fields',
    min: 0,
    max: 0.3,
    step: 0.005,
    help: 'Thickness of the complex absorbing layer at each end. Zero means hard walls: the packet reflects forever and the norm stays exactly 1.',
    format: (v) => (v <= 0 ? 'off' : `${(v * 100).toFixed(1)} %`),
  },
  {
    kind: 'slider',
    key: 'capStrength',
    label: 'Sponge strength',
    group: 'fields',
    min: 0,
    max: 1,
    step: 0.01,
    visibleIf: hasSponge,
    help: 'Peak of W(x) (×250 a.u.). Too soft and the tail reflects off the wall before it is gone; too hard and the sudden H is itself a scatterer.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'brushSize',
    label: 'Brush radius',
    group: 'fields',
    min: 0.005,
    max: 0.2,
    step: 0.005,
    visibleIf: isCustom,
    help: `Gaussian feather radius of the paint stroke on the ${BRUSH_SAMPLES}-sample brush field.`,
    format: (v) => `${(v * 100).toFixed(1)} %`,
  },
  {
    kind: 'toggle',
    key: 'brushErase',
    label: 'Brush erases',
    group: 'fields',
    visibleIf: isCustom,
    help: 'Paint toward V = 0 instead of toward V0 — carve wells out of a barrier.',
  },
];

export function describeTdse(p: SimParams): string {
  const kind = pStr(p, 'potential', 'double');
  const label = POTENTIALS.find((o) => o.value === kind)?.label ?? kind;
  return `Crank–Nicolson TDSE in a ${label.toLowerCase()} on ${gridNOf(p)} cells, packet at x₀ = ${(pNum(p, 'x0', 0.5) * 100).toFixed(0)}% with k₀ = ${pNum(p, 'k0', 60).toFixed(0)}.`;
}

export default tdseControls;
