/**
 * Sim 3 — 1D TDSE Sandbox.
 *
 * The module *is* the contract: metadata is repeated literally (rather than read
 * back from `registry.ts`) so importing a simulation never cycles through the
 * registry into the app router. Everything the stage needs — the Crank–Nicolson
 * viewport, the 27 inspector controls, the pure telemetry rows, the synchronized
 * math drawer, two guided tours and the Solver tab that streams live
 * diagnostics — is wired here and nowhere else.
 */

import type { SimModule } from '@/simulations/types';
import TdseCanvas from './Canvas';
import { SolverPanel } from './Panels';
import { describeTdse, tdseControls } from './controls';
import tdse1dDefaults from './defaults';
import { tdseDemos } from './demos';
import { tdseMath } from './math';
import { tdseTelemetry } from './telemetry';

const mod: SimModule = {
  meta: {
    slug: 'tdse-1d',
    order: 3,
    name: '1D TDSE Sandbox',
    tagline: 'Time-dependent Schrödinger PDE, solved live',
    track: 'Wave Equations & Tunneling',
    difficulty: 'Advanced',
    exploreMinutes: 30,
    description:
      'A unitary tridiagonal Crank–Nicolson solver in a dedicated Web Worker propagates iℏ∂ψ/∂t = [−ℏ²/2m ∂²/∂x² + V(x)]ψ at 60 fps. Preset wells, a Kronig–Penney crystal, a brush tool for drawing your own V(x), and live eigenstate spectra.',
    engine: 'Crank–Nicolson Web Worker',
    tags: ['PDE', 'Crank-Nicolson', 'potentials', 'worker'],
    accent: '#38bdf8',
    route: '/sim/tdse-1d',
    gpu: false,
  },
  defaultParams: tdse1dDefaults,
  controls: tdseControls,
  Canvas: TdseCanvas,
  extraTabs: [
    {
      id: 'solver',
      label: 'Solver',
      glyph: '⌗',
      Component: SolverPanel,
    },
  ],
  telemetry: tdseTelemetry,
  math: tdseMath,
  demos: tdseDemos,
  describe: describeTdse,
};

export default mod;
