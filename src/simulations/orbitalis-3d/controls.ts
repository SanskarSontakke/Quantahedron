/**
 * Orbitalis 3D — inspector control surface.
 *
 * Declared as data, not JSX: the shared InspectorDrawer turns this list into the
 * State / Visuals / Plots / Fields tabs, which is why the flagship gets the same
 * chrome, keyboard map and URL sync as the nine companion sims.
 */

import type { ControlSpec, SimParams } from '@/simulations/types';
import { pArr, pBool, pStr } from '@/store/useSimStore';
import { MAX_N, SUBSHELL_LETTERS } from '@/engine/physics/constants';

const isVolumetric = (p: SimParams) => {
  const r = pStr(p, 'render', 'raymarch');
  return r === 'raymarch' || r === 'slice';
};
const isSurface = (p: SimParams) => pStr(p, 'render', 'raymarch') === 'isosurface';
const isSlice = (p: SimParams) => pStr(p, 'render', 'raymarch') === 'slice';
const isCloud = (p: SimParams) => pStr(p, 'render', 'raymarch') === 'pointcloud';

export const orbitalisControls: ControlSpec[] = [
  /* ------------------------------- state ------------------------------- */
  {
    kind: 'select',
    key: 'basis',
    label: 'Basis',
    group: 'state',
    options: [
      { value: 'complex', label: '|n ℓ m⟩' },
      { value: 'real', label: 'pₓ p_y d — real' },
      { value: 'hybrid', label: 'sp³ hybrids' },
    ],
    help: 'Same physics, different coordinate system. The real and hybrid bases are exact linear combinations of the complex eigenstates.',
  },
  {
    kind: 'select',
    key: 'hybrid',
    label: 'Hybridisation',
    group: 'state',
    options: [
      { value: 'none', label: 'none' },
      { value: 'sp', label: 'sp' },
      { value: 'sp2', label: 'sp²' },
      { value: 'sp3', label: 'sp³' },
      { value: 'sp3d', label: 'sp³d' },
      { value: 'sp3d2', label: 'sp³d²' },
    ],
    visibleIf: (p) => pStr(p, 'basis', 'complex') === 'hybrid',
    help: 'n = 2 manifold combinations used by VSEPR geometry.',
  },
  {
    kind: 'slider',
    key: 'n',
    label: 'Principal n',
    group: 'state',
    min: 1,
    max: MAX_N,
    step: 1,
    help: 'Shell index. Sets the energy −Z²/2n² and how many nodes exist.',
  },
  {
    kind: 'slider',
    key: 'l',
    label: 'Orbital ℓ',
    group: 'state',
    min: 0,
    max: MAX_N - 1,
    step: 1,
    format: (v) => `${v} (${SUBSHELL_LETTERS[Math.min(v, SUBSHELL_LETTERS.length - 1)]})`,
    visibleIf: (p) => pStr(p, 'basis', 'complex') !== 'hybrid',
    help: 'Angular momentum magnitude √(ℓ(ℓ+1)) ℏ, and ℓ angular nodes.',
  },
  {
    kind: 'slider',
    key: 'm',
    label: 'Magnetic m',
    group: 'state',
    min: -(MAX_N - 1),
    max: MAX_N - 1,
    step: 1,
    visibleIf: (p) => pStr(p, 'basis', 'complex') !== 'hybrid',
    help: 'Projection Lz = mℏ. Sets the φ winding — the phase whirl you see on screen.',
  },
  {
    kind: 'slider',
    key: 'focus',
    label: 'Slider target slot',
    group: 'state',
    min: 0,
    max: 3,
    step: 1,
    visibleIf: (p) => pArr(p, 'ampsAmp').length > 1,
    help: 'Which term of the superposition the n / ℓ / m sliders edit. Use the Mix tab to change the rest.',
  },
  {
    kind: 'slider',
    key: 'Z',
    label: 'Nuclear charge Z',
    group: 'state',
    min: 1,
    max: 36,
    step: 1,
    unit: 'e',
    visibleIf: (p) => pStr(p, 'basis', 'complex') !== 'hybrid',
    help: 'Hydrogenic ion. Radii shrink as 1/Z, energies deepen as Z².',
  },

  /* ------------------------------ visuals ------------------------------ */
  {
    kind: 'select',
    key: 'render',
    label: 'Render mode',
    group: 'visuals',
    options: [
      { value: 'raymarch', label: 'Volume' },
      { value: 'isosurface', label: 'Surface' },
      { value: 'slice', label: 'Slice' },
      { value: 'pointcloud', label: 'Samples' },
    ],
    help: 'Raymarched probability cloud, shaded isosurface, planar cross-section, or the Born-rule sampling cloud.',
  },
  {
    kind: 'slider',
    key: 'exposure',
    label: 'Exposure',
    group: 'visuals',
    min: 0.25,
    max: 3,
    step: 0.05,
  },
  {
    kind: 'slider',
    key: 'gamma',
    label: 'Gamma',
    group: 'visuals',
    min: 1.2,
    max: 3,
    step: 0.05,
  },
  {
    kind: 'slider',
    key: 'densityScale',
    label: 'Density gain',
    group: 'visuals',
    min: 0.15,
    max: 6,
    step: 0.05,
    log: true,
    visibleIf: (p) => pStr(p, 'render', 'raymarch') !== 'pointcloud',
    help: 'Auto-exposure keeps the cloud visible; this is the manual override on top of it.',
  },
  {
    kind: 'slider',
    key: 'isoLevel',
    label: 'Isosurface level',
    group: 'visuals',
    min: 0.04,
    max: 0.98,
    step: 0.01,
    visibleIf: (p) => isSurface(p) || isVolumetric(p),
    help: 'The classic chemistry convention: a single surface of constant |ψ|².',
  },
  {
    kind: 'toggle',
    key: 'octant',
    label: 'Octant cutaway',
    group: 'visuals',
    help: 'Remove the (+,+,+) wedge so interior structure is visible.',
  },
  {
    kind: 'select',
    key: 'slicePlane',
    label: 'Slice plane',
    group: 'visuals',
    options: [
      { value: 'xy', label: 'xy' },
      { value: 'xz', label: 'xz' },
      { value: 'yz', label: 'yz' },
    ],
    visibleIf: isSlice,
  },
  {
    kind: 'slider',
    key: 'sliceOffset',
    label: 'Slice offset',
    group: 'visuals',
    min: -0.95,
    max: 0.95,
    step: 0.01,
    unit: '× r𝒃𝑜𝑥',
    visibleIf: isSlice,
  },
  {
    kind: 'slider',
    key: 'particleCount',
    label: 'Sample count',
    group: 'visuals',
    min: 2000,
    max: 90000,
    step: 1000,
    visibleIf: isCloud,
    help: 'Positions drawn from |Ψ(x,t)|² by rejection sampling.',
  },
  {
    kind: 'toggle',
    key: 'streamlines',
    label: 'Current streamlines',
    group: 'visuals',
    help: 'Integral curves of J = (ℏ/m)·Im(Ψ*∇Ψ). Non-zero only for m ≠ 0 superpositions.',
  },
  {
    kind: 'toggle',
    key: 'monochrome',
    label: 'Monochrome density',
    group: 'visuals',
    help: 'Turn off phase colour to read pure |Ψ|².',
  },
  {
    kind: 'toggle',
    key: 'showAxes',
    label: 'Axes',
    group: 'visuals',
  },

  /* ------------------------------- fields ------------------------------ */
  {
    kind: 'slider',
    key: 'zeemanB',
    label: 'Magnetic field B',
    group: 'fields',
    min: 0,
    max: 40,
    step: 0.1,
    unit: 'T',
    help: 'Orbital Zeeman: ΔE = m·μ_B·B, so m-sublevels precess apart.',
  },
  {
    kind: 'slider',
    key: 'starkE',
    label: 'Electric field F',
    group: 'fields',
    min: 0,
    max: 12,
    step: 0.05,
    unit: '10⁹ V/m',
    help: 'Linear Stark effect in the degenerate n = 2 manifold (±3Ze a₀/2).',
  },
  {
    kind: 'toggle',
    key: 'measure',
    label: 'Fire the detector',
    group: 'fields',
    help: 'Accumulates position clicks distributed exactly as |Ψ|².',
  },
  {
    kind: 'slider',
    key: 'measureRate',
    label: 'Detection rate',
    group: 'fields',
    min: 20,
    max: 600,
    step: 10,
    unit: '/s',
    visibleIf: (p) => pBool(p, 'measure', false),
  },
  {
    kind: 'toggle',
    key: 'collapse',
    label: 'Projective collapse',
    group: 'fields',
    help: 'Each burst re-prepares |Ψ⟩ in the eigenstate that was actually found.',
  },
];

export default orbitalisControls;
