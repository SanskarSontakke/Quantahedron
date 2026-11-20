/**
 * Sim 9 — Molecular Orbitals & LCAO Bonding.
 *
 * The module object is the entire contract the platform shell needs: metadata,
 * canonical state, the inspector spec, the WebGL2 volumetric stage, telemetry,
 * the KaTeX drawer content and two guided tours.
 *
 * `meta` is repeated literally (rather than read back from `registry.ts`) so
 * that importing this module never pulls the registry — and therefore the other
 * nine simulations — into the same chunk.
 *
 * Physics lives in `src/engine/physics/lcao.ts` (two-center overlap, Coulomb and
 * exchange integrals by Gauss–Legendre quadrature in prolate spheroidal
 * coordinates, the LCAO secular solution and the Morse model); rendering lives in
 * `src/engine/shaders/molecular.ts` with a Canvas2D point-cloud fallback.
 */

import type { SimModule } from '@/simulations/types';
import MolecularCanvas from './Canvas';
import { molecularControls } from './controls';
import molecularDefaults from './defaults';
import { molecularDemos } from './demos';
import { molecularDescribe, molecularMath, molecularTelemetry } from './math';

const mod: SimModule = {
  meta: {
    slug: 'molecular-orbitals',
    order: 9,
    name: 'Molecular Orbitals',
    tagline: 'H₂⁺ LCAO bonding and the Morse curve',
    track: 'Spin, Spectra & Bonding',
    difficulty: 'Advanced',
    exploreMinutes: 20,
    description:
      'Combine ψ_A ± ψ_B on two movable nuclei to build σ, σ*, π and π* orbitals with their nodal planes, then drag the bond length and watch the potential-energy curve find its minimum at the equilibrium separation.',
    engine: 'Volumetric GLSL shader',
    tags: ['LCAO', 'bonding', 'Morse potential', '3D'],
    accent: '#f472b6',
    route: '/sim/molecular-orbitals',
    gpu: true,
  },
  defaultParams: molecularDefaults,
  controls: molecularControls,
  Canvas: MolecularCanvas,
  telemetry: molecularTelemetry,
  math: molecularMath,
  demos: molecularDemos,
  describe: molecularDescribe,
};

export default mod;
