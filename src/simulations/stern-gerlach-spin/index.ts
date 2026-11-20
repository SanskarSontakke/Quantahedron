/**
 * Sim 8 — Stern–Gerlach Spin & Bloch Sphere Lab.
 *
 * A chain of up to three inhomogeneous magnets, each measuring σ·n̂ along an axis
 * the user picks (ẑ, x̂, ŷ or an arbitrary azimuth/elevation direction), each with
 * two independently pluggable output beams. Every number on screen — beam
 * thicknesses, detector counts, the precessing arrow on the sphere — comes from the
 * shared SU(2) engine in `@/engine/physics/blochSpin`: projectors
 * P± = (I ± σ·n̂)/2, |P±χ|² for the split, sequential collapse between analysers
 * and U = exp(−iθ σ·n̂/2) for the Larmor drift.
 *
 * That is what makes SG_z → SG_x → SG_z return 50/50 rather than the 100% a
 * classical vector would give, and why plugging one port turns the third magnet
 * into a deterministic state filter.
 *
 * `meta` is repeated literally rather than read from `registry.ts` so importing this
 * module never cycles back through the registry.
 */

import type { SimModule } from '@/simulations/types';
import SternGerlachCanvas from './Canvas';
import { BeamStatsPanel } from './StatsPanel';
import { describeSternGerlach, sternGerlachControls } from './controls';
import sternGerlachDefaults from './defaults';
import { sternGerlachDemos } from './demos';
import { sternGerlachMath } from './math';
import { sternGerlachTelemetry } from './telemetry';

const mod: SimModule = {
  meta: {
    slug: 'stern-gerlach-spin',
    order: 8,
    name: 'Stern–Gerlach Spin',
    tagline: 'Sequential projections on a live Bloch sphere',
    track: 'Spin, Spectra & Bonding',
    difficulty: 'Undergraduate',
    exploreMinutes: 18,
    description:
      'Chain up to three inhomogeneous magnets along arbitrary axes, block either output beam, and watch SG_z → SG_x → SG_z destroy prior knowledge of S_z while a synchronized Bloch sphere tracks the spinor through Larmor precession and projective collapse.',
    engine: 'SU(2) matrices + Three.js',
    tags: ['spin', 'SU(2)', 'Bloch sphere', 'measurement'],
    accent: '#60a5fa',
    route: '/sim/stern-gerlach-spin',
    gpu: true,
  },
  defaultParams: sternGerlachDefaults,
  controls: sternGerlachControls,
  Canvas: SternGerlachCanvas,
  extraTabs: [
    {
      id: 'stats',
      label: 'Beam counts',
      glyph: '±',
      Component: BeamStatsPanel,
    },
  ],
  telemetry: sternGerlachTelemetry,
  math: sternGerlachMath,
  demos: sternGerlachDemos,
  describe: describeSternGerlach,
};

export default mod;
