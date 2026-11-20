/**
 * Sim 1 — Orbitalis 3D (the flagship).
 *
 * The module object is the only thing the platform shell needs: metadata, the
 * canonical state, the inspector spec, the WebGL2 stage, the phasor mix editor,
 * the chart gallery, telemetry, the KaTeX drawer content and five guided tours.
 *
 * `meta` is repeated literally (rather than read back from registry.ts) so that
 * importing this module never pulls the registry — and therefore the other nine
 * simulations — into the same chunk.
 */

import type { SimModule } from '@/simulations/types';
import OrbitalisCanvas from './Canvas';
import orbitalisControls from './controls';
import orbitalisDefaults from './defaults';
import { orbitalisDemos } from './demos';
import { orbitalisMath } from './math';
import { describeOrbitalis, MixPanel, PlotsPanel } from './plots';
import { orbitalisTelemetry } from './telemetry';

const mod: SimModule = {
  meta: {
    slug: 'orbitalis-3d',
    order: 1,
    name: 'Orbitalis 3D',
    tagline: 'Volumetric hydrogenic wavefunctions & superposition engine',
    track: 'Atomic Architecture',
    difficulty: 'Undergraduate',
    exploreMinutes: 25,
    description:
      'Exact analytical solutions of the hydrogenic Schrödinger equation rendered as volumetric probability clouds, with complex vs. real vs. hybrid bases, Zeeman and Stark fields, probability-current streamlines, a measurement-and-collapse engine and a clickable spectroscopy ladder.',
    engine: 'GLSL WebGL2 raymarcher',
    tags: ['hydrogen', '3D', 'raymarching', 'superposition', 'measurement'],
    accent: '#5eead4',
    route: '/sim/orbitalis-3d',
    gpu: true,
  },
  defaultParams: orbitalisDefaults,
  controls: orbitalisControls,
  Canvas: OrbitalisCanvas,
  extraTabs: [
    { id: 'mix', label: 'Mix', glyph: 'Σ', Component: MixPanel },
    { id: 'plots', label: 'Plots', glyph: '∿', Component: PlotsPanel },
  ],
  telemetry: orbitalisTelemetry,
  math: orbitalisMath,
  demos: orbitalisDemos,
  describe: describeOrbitalis,
};

export default mod;
