/**
 * Stern–Gerlach Spin — inspector control spec.
 *
 * Four groups: the analyser chain (how many magnets, which axis each one measures,
 * which output beams are plugged), the preparation of |χ⟩, the guide field that
 * drives Larmor precession in the drift spaces and the viewport/counter.
 *
 * `visibleIf` hides the per-stage custom-angle sliders unless that stage actually
 * selects 'custom', and hides stage 2/3 controls when the chain is shorter — the
 * panel always shows exactly the apparatus being simulated.
 */

import { pBool, pNum, pStr } from '@/store/useSimStore';
import type { ControlSpec, SimParams } from '@/simulations/types';

const AXIS_OPTIONS = [
  { value: 'z', label: 'ẑ (vertical)' },
  { value: 'x', label: 'x̂ (sideways)' },
  { value: 'y', label: 'ŷ (along the beam)' },
  { value: 'custom', label: 'custom' },
];

const stageVisible = (i: number) => (p: SimParams): boolean =>
  Math.max(1, Math.min(3, Math.round(pNum(p, 'stages', 3)))) >= i;

const stageCustom = (i: number) => (p: SimParams): boolean =>
  stageVisible(i)(p) && pStr(p, `a${i}Axis`, 'z') === 'custom';

function stageControls(i: number): ControlSpec[] {
  return [
    {
      kind: 'select',
      key: `a${i}Axis`,
      label: `Analyser ${i} axis`,
      group: 'state',
      options: AXIS_OPTIONS,
      visibleIf: stageVisible(i),
      help: `Which component σ·n̂ magnet ${i} measures. ŷ is parallel to the flight direction, so it splits the beam along its own path — the classic experiment uses the transverse axes.`,
    },
    {
      kind: 'slider',
      key: `a${i}CustomAz`,
      label: `SG${i} azimuth`,
      group: 'state',
      min: -180,
      max: 180,
      step: 1,
      unit: '°',
      visibleIf: stageCustom(i),
      help: 'Azimuth of the custom quantisation axis, measured in the x̂–ŷ plane from x̂ toward ŷ.',
      format: (v) => v.toFixed(0),
    },
    {
      kind: 'slider',
      key: `a${i}CustomEl`,
      label: `SG${i} elevation`,
      group: 'state',
      min: -90,
      max: 90,
      step: 1,
      unit: '°',
      visibleIf: stageCustom(i),
      help: 'Elevation out of the x̂–ŷ plane toward ẑ: +90° is a plain ẑ analyser, 0° a transverse one.',
      format: (v) => v.toFixed(0),
    },
    {
      kind: 'toggle',
      key: `block${i}Up`,
      label: `Plug SG${i} “+” beam`,
      group: 'state',
      visibleIf: stageVisible(i),
      help: `Absorb the σ·n̂ = +1 output of magnet ${i}. Everything that hits the plate is removed from the ensemble — the projection postulate made mechanical.`,
    },
    {
      kind: 'toggle',
      key: `block${i}Down`,
      label: `Plug SG${i} “−” beam`,
      group: 'state',
      visibleIf: stageVisible(i),
      help: `Absorb the σ·n̂ = −1 output of magnet ${i}. With both plugged the analyser is a wall and the detector stays dark.`,
    },
  ];
}

export const sternGerlachControls: ControlSpec[] = [
  {
    kind: 'slider',
    key: 'stages',
    label: 'Analysers',
    group: 'state',
    min: 1,
    max: 3,
    step: 1,
    help: 'Length of the Stern–Gerlach chain. Three magnets along three different axes is the whole paradox of sequential measurement.',
    format: (v) => String(Math.round(v)),
  },
  ...stageControls(1),
  ...stageControls(2),
  ...stageControls(3),

  {
    kind: 'slider',
    key: 'spinTheta',
    label: 'Preparation θ',
    group: 'state',
    min: 0,
    max: 180,
    step: 0.5,
    unit: '°',
    help: 'Polar angle of |χ⟩ = cos(θ/2)|↑⟩ + e^{iφ}sin(θ/2)|↓⟩ on the Bloch sphere. 0 ⇒ pure |↑z⟩, 90 ⇒ equal superposition of ↑z and ↓z.',
    format: (v) => v.toFixed(1),
  },
  {
    kind: 'slider',
    key: 'spinPhi',
    label: 'Preparation φ',
    group: 'state',
    min: 0,
    max: 360,
    step: 0.5,
    unit: '°',
    help: 'Azimuth of |χ⟩: the relative phase e^{iφ} between the two amplitudes. It decides the sign of ⟨σx⟩ and ⟨σy⟩ but never P(±z).',
    format: (v) => v.toFixed(1),
  },

  {
    kind: 'slider',
    key: 'larmor',
    label: 'Guide field B',
    group: 'fields',
    min: 0,
    max: 60,
    step: 0.1,
    unit: 'mT',
    visibleIf: (p) => pNum(p, 'stages', 3) >= 2,
    help: 'Uniform field along ẑ in the drift spaces. The spinor picks up φ = γ_e·B·t with γ_e = 1.760890×10¹¹ rad·s⁻¹·T⁻¹, so a 40 µs flight already accumulates thousands of turns.',
    format: (v) => v.toFixed(1),
  },
  {
    kind: 'slider',
    key: 'precessionFreq',
    label: 'Display rate',
    group: 'fields',
    min: 0.02,
    max: 8,
    step: 0.01,
    unit: 'turn/s',
    log: true,
    visibleIf: (p) => pNum(p, 'stages', 3) >= 2,
    help: 'Wall-clock speed of the animation: one full turn per second when B = 20 mT. The honest slow-motion factor is reported in the telemetry pill.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'fieldGradient',
    label: 'Pole gradient',
    group: 'fields',
    min: 0.2,
    max: 3,
    step: 0.01,
    unit: '×10³ T/m',
    help: 'Scales the transverse deflection drawn on the bench — F_z = μ_z ∂B_z/∂z. It changes the geometry only, never a probability.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'magnetGap',
    label: 'Pole gap',
    group: 'fields',
    min: 0.1,
    max: 1.2,
    step: 0.01,
    unit: 'cm',
    help: 'Distance between the two pole faces. Wider gap ⇒ the beams spend more time between them, so they separate more before the next analyser.',
    format: (v) => v.toFixed(2),
  },

  {
    kind: 'slider',
    key: 'beamCount',
    label: 'Atoms fired',
    group: 'plots',
    min: 0,
    max: 4000,
    step: 10,
    help: 'Size of the Monte-Carlo beam feeding the histogram. Shot noise falls as 1/√N, so the empirical percentages creep toward |P±χ|² as this grows.',
    format: (v) => String(Math.round(v)),
  },
  {
    kind: 'slider',
    key: 'seed',
    label: 'Shot seed',
    group: 'plots',
    min: 1,
    max: 999,
    step: 1,
    help: 'Integer seed of the mulberry32 sampler. Same seed + same apparatus ⇒ the identical histogram, which is what makes a permalink shareable.',
    format: (v) => String(Math.round(v)),
  },
  {
    kind: 'toggle',
    key: 'reroll',
    label: 'Re-roll beam',
    group: 'plots',
    help: 'Clear the counter and deal a fresh set of atoms with the next seed, without changing the physics.',
  },
  {
    kind: 'toggle',
    key: 'showTrajectories',
    label: 'Beam animation',
    group: 'visuals',
    help: 'Slide packets along each ray so the splitting is visible as a process, not just as a static thickness.',
  },
  {
    kind: 'toggle',
    key: 'showBloch',
    label: 'Bloch sphere',
    group: 'visuals',
    help: 'Mount the synchronised 3D spinor viewer next to the bench (keys 1 / 2 / 3 pick beam, sphere or both).',
  },
  {
    kind: 'select',
    key: 'render',
    label: 'Viewport',
    group: 'visuals',
    options: [
      { value: 'beam', label: 'Beam bench' },
      { value: 'bloch', label: 'Bloch sphere' },
      { value: 'both', label: 'Both' },
    ],
    help: 'Keys 1 / 2 / 3 on the stage switch between them.',
  },
];

export function describeSternGerlach(p: SimParams): string {
  const n = Math.max(1, Math.min(3, Math.round(pNum(p, 'stages', 3))));
  const axes: string[] = [];
  for (let i = 1; i <= n; i++) {
    const kind = pStr(p, `a${i}Axis`, 'z');
    axes.push(
      kind === 'custom'
        ? `(${pNum(p, `a${i}CustomAz`, 0).toFixed(0)}°, ${pNum(p, `a${i}CustomEl`, 45).toFixed(0)}°)`
        : `${kind}̂`,
    );
  }
  const plugged: string[] = [];
  for (let i = 1; i <= n; i++) {
    if (pBool(p, `block${i}Up`, false)) plugged.push(`SG${i}+`);
    if (pBool(p, `block${i}Down`, false)) plugged.push(`SG${i}−`);
  }
  return `SG chain ${axes.join(' → ')} on |χ⟩ with θ = ${pNum(p, 'spinTheta', 0).toFixed(1)}°, φ = ${pNum(
    p,
    'spinPhi',
    0,
  ).toFixed(1)}°, ${Math.round(pNum(p, 'beamCount', 900))} atoms${plugged.length ? ` (${plugged.join(', ')} plugged)` : ''}.`;
}
