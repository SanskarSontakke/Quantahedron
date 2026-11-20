/**
 * Central simulation registry (§5.2).
 *
 * Metadata + default state + a dynamic importer live here. Because `next/dynamic`
 * needs *static* import expressions, every slug maps to its own literal
 * `() => import('./<slug>')` call — that gives each simulation its own chunk, so
 * the homepage only ever downloads Orbitalis 3D until you switch or hover.
 *
 * ⚠️ Do not import this file from a Server Component that renders Canvas
 * (use `getMeta` / `listCatalogue` only, they never touch React).
 */

import type { ComponentType } from 'react';
import orbitalisDefaults from './orbitalis-3d/defaults';
import deBroglieDefaults from './de-broglie-ring/defaults';
import tdse1dDefaults from './tdse-1d/defaults';
import tunnelingDefaults from './quantum-tunneling/defaults';
import doubleSlitDefaults from './double-slit-2d/defaults';
import oscillatorDefaults from './harmonic-oscillator/defaults';
import dipoleDefaults from './dipole-transitions/defaults';
import sternGerlachDefaults from './stern-gerlach-spin/defaults';
import molecularDefaults from './molecular-orbitals/defaults';
import uncertaintyDefaults from './uncertainty-lab/defaults';
import type {
  Difficulty,
  SimMeta,
  SimModule,
  SimParams,
  SimSlug,
  SimTrack,
} from './types';

export interface RegistryEntry {
  slug: SimSlug;
  meta: SimMeta;
  defaultParams: SimParams;
  load: () => Promise<{ default: SimModule }>;
}

const base = (
  slug: SimSlug,
  order: number,
  name: string,
  tagline: string,
  track: SimTrack,
  difficulty: Difficulty,
  exploreMinutes: number,
  engine: string,
  accent: string,
  gpu: boolean,
  description: string,
  tags: string[],
): SimMeta => ({
  slug,
  order,
  name,
  tagline,
  track,
  difficulty,
  exploreMinutes,
  engine,
  accent,
  gpu,
  description,
  tags,
  route: `/sim/${slug}`,
});

export const SIM_REGISTRY: RegistryEntry[] = [
  {
    slug: 'orbitalis-3d',
    meta: base(
      'orbitalis-3d',
      1,
      'Orbitalis 3D',
      'Volumetric hydrogenic wavefunctions & superposition engine',
      'Atomic Architecture',
      'Undergraduate',
      25,
      'GLSL WebGL2 raymarcher',
      '#5eead4',
      true,
      'Exact analytical solutions of the hydrogenic Schrödinger equation rendered as volumetric probability clouds, with complex vs. real vs. hybrid bases, Zeeman and Stark fields, probability-current streamlines, a measurement-and-collapse engine and a clickable spectroscopy ladder.',
      ['hydrogen', '3D', 'raymarching', 'superposition', 'measurement'],
    ),
    defaultParams: orbitalisDefaults,
    load: () => import('./orbitalis-3d'),
  },
  {
    slug: 'de-broglie-ring',
    meta: base(
      'de-broglie-ring',
      2,
      'de Broglie Ring',
      'Standing matter waves around the Bohr orbit',
      'Wave Equations & Tunneling',
      'Foundations',
      12,
      '2D/3D Canvas phase ring',
      '#818cf8',
      false,
      'Wrap a de Broglie wave λ = h/(mv) around a variable-radius orbit and watch destructive interference dissolve non-integer winding numbers, then snap into resonance the instant 2πr = nλ. Includes a Scale Explorer spanning thermal neutrons to cricket balls.',
      ['matter waves', 'Bohr model', 'resonance'],
    ),
    defaultParams: deBroglieDefaults,
    load: () => import('./de-broglie-ring'),
  },
  {
    slug: 'tdse-1d',
    meta: base(
      'tdse-1d',
      3,
      '1D TDSE Sandbox',
      'Time-dependent Schrödinger PDE, solved live',
      'Wave Equations & Tunneling',
      'Advanced',
      30,
      'Crank–Nicolson Web Worker',
      '#38bdf8',
      false,
      'A unitary tridiagonal Crank–Nicolson solver in a dedicated Web Worker propagates iℏ∂ψ/∂t = [−ℏ²/2m ∂²/∂x² + V(x)]ψ at 60 fps. Preset wells, a Kronig–Penney crystal, a brush tool for drawing your own V(x), and live eigenstate spectra.',
      ['PDE', 'Crank-Nicolson', 'potentials', 'worker'],
    ),
    defaultParams: tdse1dDefaults,
    load: () => import('./tdse-1d'),
  },
  {
    slug: 'quantum-tunneling',
    meta: base(
      'quantum-tunneling',
      4,
      'Quantum Tunneling',
      'Barrier penetration, T(E) curves and STM',
      'Wave Equations & Tunneling',
      'Undergraduate',
      18,
      'Split-Step Fourier FFT',
      '#fbbf24',
      false,
      'Fire tunable Gaussian wavepackets at rectangular, triangular and double resonant barriers. A synchronized analytical T(E) plot exposes exponential evanescent decay below the barrier and Ramsauer–Townsend resonances above it, with an STM tip mode.',
      ['tunneling', 'FFT', 'STM', 'resonance'],
    ),
    defaultParams: tunnelingDefaults,
    load: () => import('./quantum-tunneling'),
  },
  {
    slug: 'double-slit-2d',
    meta: base(
      'double-slit-2d',
      5,
      '2D Double-Slit',
      'Wavepacket interference and which-path decoherence',
      'Wave Equations & Tunneling',
      'Advanced',
      20,
      'WebGL2 GPU RK4 shader',
      '#a78bfa',
      true,
      'A real-time 2D Schrödinger solver running on ping-pong float framebuffers with a fourth-order Runge–Kutta Laplacian stencil, a phosphor detector screen accumulating single-electron hits, and a which-path detector that wipes the fringes away.',
      ['interference', 'GPU', 'measurement', 'complementarity'],
    ),
    defaultParams: doubleSlitDefaults,
    load: () => import('./double-slit-2d'),
  },
  {
    slug: 'harmonic-oscillator',
    meta: base(
      'harmonic-oscillator',
      6,
      'Harmonic Oscillator',
      'Hermite eigenstates, coherent states, correspondence',
      'Wave Equations & Tunneling',
      'Undergraduate',
      15,
      'Analytical + symplectic GPU',
      '#34d399',
      false,
      'Stack Hermite–Gauss eigenstates into any superposition, compare |ψ|² against the classical probability density, and launch a non-dispersing Glauber coherent state |α⟩ that oscillates exactly like a mass on a spring.',
      ['hermite', 'coherent states', 'correspondence principle'],
    ),
    defaultParams: oscillatorDefaults,
    load: () => import('./harmonic-oscillator'),
  },
  {
    slug: 'dipole-transitions',
    meta: base(
      'dipole-transitions',
      7,
      'Dipole Transitions',
      'Rabi oscillations and electric selection rules',
      'Spin, Spectra & Bonding',
      'Advanced',
      20,
      'Driven two-level ODE solver',
      '#fb7185',
      false,
      'Couple an atom to a tunable laser field E(t) = E₀cos(ωLt)ẑ, sweep through resonance to watch Rabi flopping and π-pulses on a live population plot, and see ⟨f|r̂|i⟩ = 0 shut down forbidden transitions in real time.',
      ['Rabi', 'selection rules', 'laser', 'spectroscopy'],
    ),
    defaultParams: dipoleDefaults,
    load: () => import('./dipole-transitions'),
  },
  {
    slug: 'stern-gerlach-spin',
    meta: base(
      'stern-gerlach-spin',
      8,
      'Stern–Gerlach Spin',
      'Sequential projections on a live Bloch sphere',
      'Spin, Spectra & Bonding',
      'Undergraduate',
      18,
      'SU(2) matrices + Three.js',
      '#60a5fa',
      true,
      'Chain up to three inhomogeneous magnets along arbitrary axes, block either output beam, and watch SG_z → SG_x → SG_z destroy prior knowledge of S_z while a synchronized Bloch sphere tracks the spinor through Larmor precession and projective collapse.',
      ['spin', 'SU(2)', 'Bloch sphere', 'measurement'],
    ),
    defaultParams: sternGerlachDefaults,
    load: () => import('./stern-gerlach-spin'),
  },
  {
    slug: 'molecular-orbitals',
    meta: base(
      'molecular-orbitals',
      9,
      'Molecular Orbitals',
      'H₂⁺ LCAO bonding and the Morse curve',
      'Spin, Spectra & Bonding',
      'Advanced',
      20,
      'Volumetric GLSL shader',
      '#f472b6',
      true,
      'Combine ψ_A ± ψ_B on two movable nuclei to build σ, σ*, π and π* orbitals with their nodal planes, then drag the bond length and watch the potential-energy curve find its minimum at the equilibrium separation.',
      ['LCAO', 'bonding', 'Morse potential', '3D'],
    ),
    defaultParams: molecularDefaults,
    load: () => import('./molecular-orbitals'),
  },
  {
    slug: 'uncertainty-lab',
    meta: base(
      'uncertainty-lab',
      10,
      'Uncertainty Forge',
      'Fourier duality and the Δx·Δp floor',
      'Wave Equations & Tunneling',
      'Foundations',
      12,
      'Real-time 1D FFT dual plot',
      '#22d3ee',
      false,
      'Two canvases locked together by a radix-2 FFT: squeeze a wavepacket narrower in position and watch its momentum spectrum explode outward, with a live Heisenberg gauge that only turns green at the exact ħ/2 minimum-uncertainty floor.',
      ['Fourier', 'Heisenberg', 'wavepackets'],
    ),
    defaultParams: uncertaintyDefaults,
    load: () => import('./uncertainty-lab'),
  },
];

export const SIM_LIST: SimMeta[] = SIM_REGISTRY.map((e) => e.meta).sort(
  (a, b) => a.order - b.order,
);

export const SIM_SLUGS = SIM_REGISTRY.map((e) => e.slug) as SimSlug[];

export const TRACKS: SimTrack[] = [
  'Atomic Architecture',
  'Wave Equations & Tunneling',
  'Spin, Spectra & Bonding',
];

export function isSimSlug(value: string | null | undefined): value is SimSlug {
  return Boolean(value && SIM_REGISTRY.some((e) => e.slug === value));
}

export function getMeta(slug: SimSlug | string | null | undefined): SimMeta | undefined {
  return SIM_REGISTRY.find((e) => e.slug === slug)?.meta;
}

export function getEntry(slug: SimSlug | string): RegistryEntry | undefined {
  return SIM_REGISTRY.find((e) => e.slug === slug);
}

/**
 * Load a fully typed module (metadata + defaultParams + Canvas are all that the
 * homepage needs; heavy canvas code arrives in its own chunk).
 */
export async function loadModule(slug: SimSlug | string): Promise<SimModule | null> {
  const entry = getEntry(slug);
  if (!entry) return null;
  const mod = await entry.load();
  return mod.default;
}

export type { SimModule, SimMeta, SimParams, SimSlug };
export type SimCanvasComponent = ComponentType<{ slug: SimSlug }>;
