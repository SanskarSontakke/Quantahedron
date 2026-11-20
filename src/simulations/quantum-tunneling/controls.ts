/**
 * Sim 4 — Inspector Drawer control spec (§3.3 layout, Visuals / State / Plots /
 * Fields groups) plus the one-line state summary used by cards and OG previews.
 */

import type { ControlSpec, SimParams } from '@/simulations/types';
import { pBool, pNum, pStr } from '@/store/useSimStore';
import { BARRIERS, barrierOf, clampNum, geomOf, kOfEnergy, massOf, TUN_VIEWS } from './model';

const VIEW_LABELS: Record<string, string> = {
  wave: 'Beam line',
  transmission: 'T(E) theory',
  both: 'Beam + T(E)',
};

export const tunnelControls: ControlSpec[] = [
  /* --------------------------------- state --------------------------------- */
  {
    kind: 'select',
    key: 'barrier',
    label: 'Barrier shape',
    group: 'state',
    options: BARRIERS.map((b) => ({ value: b.value, label: b.label })),
    help: 'Rectangular and double barriers use the exact closed forms; the tilted barrier is a piecewise-constant transfer-matrix product.',
  },
  {
    kind: 'slider',
    key: 'V0',
    label: 'Barrier height V₀',
    group: 'state',
    min: 0.5,
    max: 40,
    step: 0.25,
    unit: 'a.u.',
    help: 'Everything scales with the ratio E₀/V₀. κ = √(2m(V₀−E₀)) sets the evanescent decay.',
  },
  {
    kind: 'slider',
    key: 'width',
    label: 'Barrier width a',
    group: 'state',
    min: 0.005,
    max: 0.3,
    step: 0.005,
    format: (v) => `${(v * 24).toFixed(2)} a.u.`,
    help: 'T below the barrier falls like e^(−2κa): 0.5 a.u. of extra barrier is worth an order of magnitude.',
  },
  {
    kind: 'slider',
    key: 'gap',
    label: 'Well separation (double)',
    group: 'state',
    min: 0.01,
    max: 0.4,
    step: 0.005,
    format: (v) => `${(v * 24).toFixed(2)} a.u.`,
    visibleIf: (p) => barrierOf(p) === 'double',
    help: 'Fabry–Pérot condition for perfect transmission: k_well·gap = nπ.',
  },
  {
    kind: 'slider',
    key: 'tilt',
    label: 'Field tilt (triangular)',
    group: 'state',
    min: 0.02,
    max: 1,
    step: 0.02,
    visibleIf: (p) => barrierOf(p) === 'tri',
    help: 'Fraction of the barrier that ramps down to zero — the strong-field emission geometry, where WKB replaces the sinh formula.',
  },
  {
    kind: 'slider',
    key: 'E0',
    label: 'Packet energy E₀',
    group: 'state',
    min: 0.2,
    max: 40,
    step: 0.1,
    unit: 'a.u.',
    help: 'Mean kinetic energy measured in the V = 0 leads, so k₀ = √(2mE₀) exactly.',
  },
  {
    kind: 'slider',
    key: 'sigmaK',
    label: 'Momentum spread Δk',
    group: 'state',
    min: 2,
    max: 60,
    step: 1,
    format: (v) => `${(v / 24).toFixed(3)} a.u.⁻¹`,
    help: 'Sets σ_x = 1/(2Δk). A narrow Δk makes the packet monochromatic so the simulated T matches T(E₀); a wide one samples the whole curve at once.',
  },
  {
    kind: 'slider',
    key: 'packetX',
    label: 'Launch position',
    group: 'state',
    min: 0.04,
    max: 0.42,
    step: 0.005,
    format: (v) => `${((v - 0.5) * 24).toFixed(2)} a.u.`,
    help: 'Keep it clear of the left sponge or the initial tail is absorbed and counted as reflection.',
  },
  {
    kind: 'slider',
    key: 'mass',
    label: 'Particle mass m',
    group: 'state',
    min: 0.1,
    max: 6,
    step: 0.1,
    unit: 'mₑ',
    help: 'κ ∝ √m, so a heavier particle tunnels far less: a 4× mass change is a 2× change in the decay exponent.',
  },

  /* -------------------------------- visuals -------------------------------- */
  {
    kind: 'select',
    key: 'view',
    label: 'Viewport',
    group: 'visuals',
    options: TUN_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] ?? v })),
    help: 'The beam line integrates the split-step propagator; the T(E) panel is pure closed-form theory, sampled at 256 energies.',
  },
  {
    kind: 'toggle',
    key: 'colorPhase',
    label: 'Phase-coloured density',
    group: 'visuals',
    help: 'Hue = arg ψ on the cyclic twilight wheel, luminance = |ψ|². The evanescent tail keeps a fixed hue: it is not propagating.',
  },
  {
    kind: 'toggle',
    key: 'showReIm',
    label: 'Overlay Re ψ / Im ψ',
    group: 'visuals',
  },
  {
    kind: 'toggle',
    key: 'logDensity',
    label: 'Log |ψ|² (2 decades)',
    group: 'visuals',
    help: 'The only way to see the exponentially small transmitted packet and the incident one at the same time.',
  },
  {
    kind: 'toggle',
    key: 'showPotential',
    label: 'Show V(x)',
    group: 'visuals',
  },
  {
    kind: 'toggle',
    key: 'showEvanescent',
    label: 'Dashed e^(−κx) envelope',
    group: 'visuals',
    help: 'Draws the exact decay constant of the forbidden region over the simulated tail — they agree to a few percent.',
  },

  /* --------------------------------- plots --------------------------------- */
  {
    kind: 'toggle',
    key: 'showAnalytical',
    label: 'Analytical T(E) curve',
    group: 'plots',
  },
  {
    kind: 'toggle',
    key: 'logT',
    label: 'Log T axis (4 decades)',
    group: 'plots',
    help: 'Off: T from 0 to 1, resonances look like thin spikes. On: the exponential below-barrier tail becomes a straight line.',
  },
  {
    kind: 'slider',
    key: 'energyScan',
    label: 'Probe energy',
    group: 'plots',
    min: 0,
    max: 40,
    step: 0.1,
    unit: 'a.u.',
    format: (v) => (v < 0.05 ? 'E₀' : v.toFixed(2)),
    help: '0 follows the packet. Any other value parks a second marker on the T(E) curve so you can read the theory at a chosen energy.',
  },
  {
    kind: 'toggle',
    key: 'stmMode',
    label: 'STM tip mode',
    group: 'plots',
    help: 'Replaces the beam with a constant-current imaging panel: I ∝ V·T(d), three adsorbates on a plane.',
  },
  {
    kind: 'slider',
    key: 'stmBias',
    label: 'Bias voltage',
    group: 'plots',
    min: 0.05,
    max: 2,
    step: 0.05,
    visibleIf: (p) => pBool(p, 'stmMode', false),
    help: 'Scales the current linearly — bias changes brightness, tilt changes contrast.',
  },
  {
    kind: 'slider',
    key: 'stmHeight',
    label: 'Tip–sample set point',
    group: 'plots',
    min: 0.01,
    max: 0.2,
    step: 0.005,
    format: (v) => `${(v * 24).toFixed(2)} a.u.`,
    visibleIf: (p) => pBool(p, 'stmMode', false),
  },
  {
    kind: 'slider',
    key: 'stmAmp',
    label: 'Adsorbate height',
    group: 'plots',
    min: 0,
    max: 1.2,
    step: 0.05,
    visibleIf: (p) => pBool(p, 'stmMode', false),
  },
  {
    kind: 'slider',
    key: 'stmContrast',
    label: 'Electronic contrast',
    group: 'plots',
    min: 0,
    max: 0.8,
    step: 0.05,
    visibleIf: (p) => pBool(p, 'stmMode', false),
    help: 'Fraction by which the local barrier drops over an atom. With contrast = 0 the apparent profile equals the true one; a modest 35 % makes atoms look far taller than they are.',
  },

  /* --------------------------------- fields -------------------------------- */
  {
    kind: 'slider',
    key: 'gridN',
    label: 'Grid points N',
    group: 'fields',
    min: 128,
    max: 4096,
    step: 128,
    format: (v) => `${Math.round(v)}`,
    help: 'Rounded to a power of two for the radix-2 FFT. dx = 24/N a.u.',
  },
  {
    kind: 'slider',
    key: 'dt',
    label: 'Time step Δt',
    group: 'fields',
    min: 0.0002,
    max: 0.01,
    step: 0.0002,
    unit: 'a.u.',
    format: (v) => v.toFixed(4),
    help: 'Strang splitting is second order and unitary; accuracy only needs Δt·(V₀+E) ≪ 1 on the occupied modes.',
  },
  {
    kind: 'slider',
    key: 'stepsPerFrame',
    label: 'Steps / frame',
    group: 'fields',
    min: 1,
    max: 32,
    step: 1,
    format: (v) => `${Math.round(v)}`,
    help: 'Physical time per rendered frame = stepsPerFrame·Δt.',
  },
  {
    kind: 'slider',
    key: 'capWidth',
    label: 'Sponge width',
    group: 'fields',
    min: 0,
    max: 0.3,
    step: 0.005,
    format: (v) => `${(v * 24).toFixed(2)} a.u.`,
    help: 'Complex absorbing layers at both ends; they turn the box into an open beam line and are billed side by side.',
  },
  {
    kind: 'slider',
    key: 'capStrength',
    label: 'Sponge strength',
    group: 'fields',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Peak W₀ of the −iW(x) term. Too small and the packet reflects off the box wall instead of vanishing.',
  },
];

export function describeTunnel(p: SimParams): string {
  const g = geomOf(p);
  const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
  const k0 = kOfEnergy(e0, massOf(p));
  const above = e0 >= g.v0;
  return pBool(p, 'stmMode', false)
    ? `STM tip mode: I ∝ V·T(d) with d = ${(clampNum(pNum(p, 'stmHeight', 0.05), 0.01, 0.2) * 24).toFixed(2)} a.u., E₀ = ${e0.toFixed(1)} against V₀ = ${g.v0.toFixed(1)}.`
    : `${g.kind === 'double' ? 'Double' : g.kind === 'tri' ? 'Tilted' : 'Rectangular'} barrier: E₀ = ${e0.toFixed(1)} ${above ? 'above' : 'below'} V₀ = ${g.v0.toFixed(1)}, a = ${g.a.toFixed(2)} a.u., k₀ = ${k0.toFixed(2)}, view ${pStr(p, 'view', 'both')} of ${TUN_VIEWS.length}.`;
}

export default tunnelControls;
