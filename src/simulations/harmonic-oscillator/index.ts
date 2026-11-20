/**
 * Sim 6 — Quantum Harmonic Oscillator & Coherent States.
 *
 * The module is the whole contract: metadata mirrored from the registry entry
 * (written out literally so importing this file never cycles back through
 * `registry.ts`), the canonical default state, the inspector spec, the analytic
 * Hermite–Gauss canvas, telemetry, the synchronized math drawer and two guided
 * tours.
 *
 * Nothing here solves a PDE: ψₙ(x) is evaluated exactly (log-space normalisation
 * plus the three-term Hermite recurrence) and time evolution is the exact
 * propagator cₙ → cₙe^{−i(n+½)ωt}, so the ground state is stationary to machine
 * precision and a Glauber state circles phase space at precisely ω.
 */

import type { SimModule } from '@/simulations/types';
import OscillatorCanvas from './Canvas';
import { OscillatorPanel } from './Panels';
import { describeOscillator, oscillatorControls } from './controls';
import oscillatorDefaults from './defaults';
import { oscillatorDemos } from './demos';
import { oscillatorMath } from './math';
import { oscillatorTelemetry } from './telemetry';

const mod: SimModule = {
  meta: {
    slug: 'harmonic-oscillator',
    order: 6,
    name: 'Harmonic Oscillator',
    tagline: 'Hermite eigenstates, coherent states, correspondence',
    track: 'Wave Equations & Tunneling',
    difficulty: 'Undergraduate',
    exploreMinutes: 15,
    description:
      'Stack Hermite–Gauss eigenstates into any superposition, compare |ψ|² against the classical probability density, and launch a non-dispersing Glauber coherent state |α⟩ that oscillates exactly like a mass on a spring.',
    engine: 'Analytical + symplectic GPU',
    tags: ['hermite', 'coherent states', 'correspondence principle'],
    accent: '#34d399',
    route: '/sim/harmonic-oscillator',
    gpu: false,
  },
  defaultParams: oscillatorDefaults,
  controls: oscillatorControls,
  Canvas: OscillatorCanvas,
  extraTabs: [
    {
      id: 'amplitudes',
      label: 'Amplitudes',
      glyph: 'Σ',
      Component: OscillatorPanel,
    },
  ],
  telemetry: oscillatorTelemetry,
  math: oscillatorMath,
  demos: oscillatorDemos,
  describe: describeOscillator,
};

export default mod;
