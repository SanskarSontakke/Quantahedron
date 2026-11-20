/**
 * Sim 7 — Spectral Transitions & Dipole Radiation.
 *
 * A driven two-level (really: two hydrogenic levels) atom in the length gauge,
 * integrated live on the main thread, with the dipole element ⟨f|ẑ|i⟩ computed
 * from first principles by the shared hydrogenic engine and the radiation it
 * implies made visible: population slosh, Bloch precession, ⟨d⟩(t) against the
 * laser waveform, and a |Ψ(t)|² slice that physically moves along ẑ at ω₁₂.
 *
 * The module object is the whole contract; `meta` is repeated literally rather
 * than read from `registry.ts` so importing this file never cycles back through
 * the registry.
 */

import type { SimModule } from '@/simulations/types';
import DipoleCanvas from './Canvas';
import { SelectionRulePanel } from './ProbePanel';
import { describeDipole, dipoleControls } from './controls';
import dipoleDefaults from './defaults';
import { dipoleDemos } from './demos';
import { dipoleMath } from './math';
import { dipoleTelemetry } from './telemetry';

const mod: SimModule = {
  meta: {
    slug: 'dipole-transitions',
    order: 7,
    name: 'Dipole Transitions',
    tagline: 'Rabi oscillations and electric selection rules',
    track: 'Spin, Spectra & Bonding',
    difficulty: 'Advanced',
    exploreMinutes: 20,
    description:
      'Couple an atom to a tunable laser field E(t) = E₀cos(ωLt)ẑ, sweep through resonance to watch Rabi flopping and π-pulses on a live population plot, and see ⟨f|r̂|i⟩ = 0 shut down forbidden transitions in real time.',
    engine: 'Driven two-level ODE solver',
    tags: ['Rabi', 'selection rules', 'laser', 'spectroscopy'],
    accent: '#fb7185',
    route: '/sim/dipole-transitions',
    gpu: false,
  },
  defaultParams: dipoleDefaults,
  controls: dipoleControls,
  Canvas: DipoleCanvas,
  extraTabs: [
    {
      id: 'rules',
      label: 'Selection rules',
      glyph: 'Δℓ',
      Component: SelectionRulePanel,
    },
  ],
  telemetry: dipoleTelemetry,
  math: dipoleMath,
  demos: dipoleDemos,
  describe: describeDipole,
};

export default mod;
