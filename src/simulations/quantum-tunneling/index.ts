/**
 * Sim 4 — Quantum Tunneling & Barrier Lab.
 *
 * Metadata is repeated literally instead of being read back from `registry.ts`, so
 * importing a simulation module never cycles through the registry into the app
 * router. The contract binds the split-step beam line (`TunnelCanvas`), the 27
 * inspector controls, the pure `telemetry` rows, the KaTeX drawer, the two guided
 * tours and the Beam tab that streams the live R/T ledger against the closed forms.
 */

import type { SimModule } from '@/simulations/types';
import { BeamPanel } from './Panels';
import { describeTunnel, tunnelControls } from './controls';
import tunnelingDefaults from './defaults';
import { tunnelDemos } from './demos';
import { tunnelMath } from './math';
import TunnelCanvas from './TunnelCanvas';
import { tunnelTelemetry } from './telemetry';

const mod: SimModule = {
  meta: {
    slug: 'quantum-tunneling',
    order: 4,
    name: 'Quantum Tunneling',
    tagline: 'Barrier penetration, T(E) curves and STM',
    track: 'Wave Equations & Tunneling',
    difficulty: 'Undergraduate',
    exploreMinutes: 18,
    description:
      'Fire tunable Gaussian wavepackets at rectangular, triangular and double resonant barriers. A synchronized analytical T(E) plot exposes exponential evanescent decay below the barrier and Ramsauer–Townsend resonances above it, with an STM tip mode.',
    engine: 'Split-Step Fourier FFT',
    tags: ['tunneling', 'FFT', 'STM', 'resonance'],
    accent: '#fbbf24',
    route: '/sim/quantum-tunneling',
    gpu: false,
  },
  defaultParams: tunnelingDefaults,
  controls: tunnelControls,
  Canvas: TunnelCanvas,
  extraTabs: [
    {
      id: 'beam',
      label: 'Beam',
      glyph: '⇥',
      Component: BeamPanel,
    },
  ],
  telemetry: tunnelTelemetry,
  math: tunnelMath,
  demos: tunnelDemos,
  describe: describeTunnel,
};

export default mod;
