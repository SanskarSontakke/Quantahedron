/**
 * Sim 2 — de Broglie Standing-Wave Atom.
 *
 * The module is the whole contract: metadata duplicated from the registry
 * entry (kept literal here so importing this file never cycles back through
 * `registry.ts`), the canonical default state, the inspector spec, the live
 * canvas, telemetry, the synchronized math drawer and two guided tours.
 */

import type { SimModule } from '@/simulations/types';
import DeBroglieCanvas from './Canvas';
import { ResonancePanel } from './Panels';
import { deBroglieControls, describeDeBroglie } from './controls';
import deBroglieDefaults from './defaults';
import { deBroglieDemos } from './demos';
import { deBroglieMath } from './math';
import { deBroglieTelemetry } from './telemetry';

const mod: SimModule = {
  meta: {
    slug: 'de-broglie-ring',
    order: 2,
    name: 'de Broglie Ring',
    tagline: 'Standing matter waves around the Bohr orbit',
    track: 'Wave Equations & Tunneling',
    difficulty: 'Foundations',
    exploreMinutes: 12,
    description:
      'Wrap a de Broglie wave λ = h/(mv) around a variable-radius orbit and watch destructive interference dissolve non-integer winding numbers, then snap into resonance the instant 2πr = nλ. Includes a Scale Explorer spanning thermal neutrons to cricket balls.',
    engine: '2D/3D Canvas phase ring',
    tags: ['matter waves', 'Bohr model', 'resonance'],
    accent: '#818cf8',
    route: '/sim/de-broglie-ring',
    gpu: false,
  },
  defaultParams: deBroglieDefaults,
  controls: deBroglieControls,
  Canvas: DeBroglieCanvas,
  extraTabs: [
    {
      id: 'resonance',
      label: 'Resonance',
      glyph: '∿',
      Component: ResonancePanel,
    },
  ],
  telemetry: deBroglieTelemetry,
  math: deBroglieMath,
  demos: deBroglieDemos,
  describe: describeDeBroglie,
};

export default mod;
