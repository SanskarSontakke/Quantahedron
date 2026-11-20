import type { ControlSpec } from '@/simulations/types';

/**
 * Inspector controls for Sim 9. Four groups so the drawer tab bar reads as
 * physics (state), rendering (visuals), the Hamiltonian (fields) and the
 * spectroscopy plot (plots) instead of one long slider stack.
 */
export const molecularControls: ControlSpec[] = [
  /* ------------------------------- state ------------------------------- */
  {
    kind: 'slider',
    key: 'R',
    group: 'state',
    label: 'Bond length R',
    min: 0.4,
    max: 12,
    step: 0.01,
    unit: 'a₀',
    format: (v) => v.toFixed(2),
    help: 'Internuclear separation. Drag the potential-energy curve cursor too.',
  },
  {
    kind: 'select',
    key: 'ao',
    group: 'state',
    label: 'Atomic basis',
    options: [
      { value: '1s', label: '1s → σ' },
      { value: '2pz', label: '2p_z → σ' },
      { value: '2px', label: '2p_x → π' },
    ],
    help: 'Which hydrogenic AO sits on each nucleus. 2p_z lies on the bond axis (σ), 2p_x is side-on (π).',
  },
  {
    kind: 'select',
    key: 'combo',
    group: 'state',
    label: 'Combination',
    options: [
      { value: 'bonding', label: 'ψ₊  bonding' },
      { value: 'antibonding', label: 'ψ₋  antibonding' },
    ],
    help: 'In-phase vs out-of-phase superposition. Antibonding always buys a nodal plane between the nuclei.',
  },

  /* ------------------------------- fields ------------------------------ */
  {
    kind: 'slider',
    key: 'Z',
    group: 'fields',
    label: 'Nuclear charge Z',
    min: 1,
    max: 4,
    step: 1,
    unit: 'e',
    format: (v) => v.toFixed(0),
    help: 'Both nuclei share the charge: Z = 1 is H₂⁺, Z = 2 HeH²⁺ … Coulomb attraction scales as Z, the repulsion as Z².',
  },
  {
    kind: 'select',
    key: 'zetaMode',
    group: 'fields',
    label: 'AO exponent ζ',
    options: [
      { value: 'variational', label: 'variational (best ζ per R)' },
      { value: 'bare', label: 'bare ζ = Z' },
    ],
    help: 'Re-optimising ζ at each R is what moves R₀ from 2.50 a₀ to 2.01 a₀ and deepens the well by a third.',
  },
  {
    kind: 'slider',
    key: 'cloudCount',
    group: 'fields',
    label: 'Cloud samples',
    min: 2000,
    max: 60000,
    step: 1000,
    format: (v) => `${Math.round(v / 1000)}k`,
    help: 'Points drawn in the point-cloud view — a |ψ|² rejection sample, so it is the density itself made visible.',
    visibleIf: (p) => p.render === 'pointcloud',
  },

  /* ------------------------------ visuals ------------------------------ */
  {
    kind: 'select',
    key: 'render',
    group: 'visuals',
    label: 'Render mode',
    options: [
      { value: 'raymarch', label: 'volumetric |ψ|²' },
      { value: 'isosurface', label: 'iso-shell' },
      { value: 'pointcloud', label: 'point cloud' },
    ],
    help: 'Raymarched volume, a single probability shell, or sampled detector points. Without WebGL2 the stage falls back to the CPU point cloud.',
  },
  {
    kind: 'slider',
    key: 'isoLevel',
    group: 'visuals',
    label: 'Iso level',
    min: 0.05,
    max: 0.95,
    step: 0.01,
    unit: '×peak',
    format: (v) => v.toFixed(2),
    visibleIf: (p) => p.render === 'isosurface',
  },
  {
    kind: 'slider',
    key: 'exposure',
    group: 'visuals',
    label: 'Exposure',
    min: 0.1,
    max: 4,
    step: 0.05,
    format: (v) => v.toFixed(2),
    help: 'Optical density of the cloud — how fast the raymarch extinguishes.',
  },
  {
    kind: 'slider',
    key: 'gamma',
    group: 'visuals',
    label: 'Gamma',
    min: 1,
    max: 3.5,
    step: 0.1,
    format: (v) => v.toFixed(1),
  },
  {
    kind: 'toggle',
    key: 'monochrome',
    group: 'visuals',
    label: 'Monochrome (drop phase colour)',
  },
  {
    kind: 'toggle',
    key: 'showNuclei',
    group: 'visuals',
    label: 'Nucleus markers',
  },
  {
    kind: 'toggle',
    key: 'showNodePlane',
    group: 'visuals',
    label: 'Nodal-plane sheet',
    help: 'The surface where ψ = 0: the bond midpoint plane for σ*, the plane containing the axis for π.',
  },
  {
    kind: 'slider',
    key: 'camDist',
    group: 'visuals',
    label: 'Camera distance',
    min: 8,
    max: 60,
    step: 0.5,
    unit: 'a₀',
    format: (v) => v.toFixed(0),
    help: 'Drag the stage to orbit, wheel to zoom.',
  },

  /* ------------------------------- plots ------------------------------- */
  {
    kind: 'toggle',
    key: 'showCurve',
    group: 'plots',
    label: 'Potential-energy curve',
  },
  {
    kind: 'select',
    key: 'curveModel',
    group: 'plots',
    label: 'Curve model',
    options: [
      { value: 'morse', label: 'Morse V(R) = Dₑ(1−e^{−a(R−R₀)})²' },
      { value: 'exact1s', label: 'LCAO secular E±(R)' },
    ],
    help: 'Which curve the stage plot treats as the live one; the other is drawn for comparison.',
    visibleIf: (p) => p.showCurve !== false,
  },
  {
    kind: 'toggle',
    key: 'markEquilibrium',
    group: 'plots',
    label: 'Mark R₀ and Dₑ',
    visibleIf: (p) => p.showCurve !== false,
  },
];

export default molecularControls;
