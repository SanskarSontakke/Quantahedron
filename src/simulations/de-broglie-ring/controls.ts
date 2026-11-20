/**
 * de Broglie Ring — inspector control spec.
 *
 * The shell turns this array into the State / Visuals / Fields tabs of the
 * Inspector Drawer, so the sim never writes its own sliders. Every key listed
 * here exists in `defaults.ts`; `visibleIf` keeps the mode-specific knobs out of
 * the way (λ only matters once the wavelength is unlocked, the beam rig only
 * matters inside the Scale Explorer).
 */

import type { ControlSpec, SimParams } from '@/simulations/types';
import { pBool, pStr } from '@/store/useSimStore';
import { MASS_PRESETS, deBroglieSI, formatLength, massLabel, ringState, speedLabel } from './physics';

const isScale = (p: SimParams) => pStr(p, 'tab', 'orbit') === 'scale';

export const deBroglieControls: ControlSpec[] = [
  {
    kind: 'select',
    key: 'tab',
    label: 'View',
    group: 'state',
    options: [
      { value: 'orbit', label: 'Standing-wave orbit' },
      { value: 'scale', label: 'Scale Explorer' },
    ],
    help: 'Keys 1 / 2 switch the stage between the orbit and the real-beam rig.',
  },
  {
    kind: 'slider',
    key: 'radiusAU',
    label: 'Orbit radius r',
    group: 'state',
    min: 0.5,
    max: 20,
    step: 0.01,
    unit: 'a₀',
    visibleIf: (p) => !isScale(p),
    help: 'Drag the ring in the stage to sweep r continuously.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'nTarget',
    label: 'Target winding n',
    group: 'state',
    min: 1,
    max: 8,
    step: 0.05,
    visibleIf: (p) => !isScale(p),
    help: 'While λ is locked the ring is tuned to 2πr = nλ at this n.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'toggle',
    key: 'wavelengthLock',
    label: 'Lock λ to 2πr/n',
    group: 'state',
    visibleIf: (p) => !isScale(p),
    help: 'On: the wave stretches with the orbit, so every radius is resonant. Off: λ freezes and dragging r sweeps n = 2πr/λ through resonance and cancellation.',
  },
  {
    kind: 'slider',
    key: 'wavelengthAU',
    label: 'de Broglie λ',
    group: 'state',
    min: 2,
    max: 140,
    step: 0.01,
    log: true,
    unit: 'a₀',
    visibleIf: (p) => !isScale(p) && !pBool(p, 'wavelengthLock', true),
    help: 'Frozen wavelength. Resonant radii are rₙ = nλ/2π.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'lockWidth',
    label: 'Capture band',
    group: 'state',
    min: 0,
    max: 0.3,
    step: 0.005,
    visibleIf: (p) => !isScale(p),
    help: 'Half-width in n over which the orbit snaps onto the nearest integer winding.',
    format: (v) => `±${v.toFixed(3)}`,
  },
  {
    kind: 'toggle',
    key: 'sweep',
    label: 'Sweep n',
    group: 'state',
    visibleIf: (p) => !isScale(p),
    help: 'Drive n continuously across the integers — the mode the auto-demo uses.',
  },
  {
    kind: 'slider',
    key: 'sweepSpeed',
    label: 'Sweep rate',
    group: 'state',
    min: 0.05,
    max: 1.5,
    step: 0.01,
    unit: 'n/s',
    visibleIf: (p) => !isScale(p) && pBool(p, 'sweep', false),
    format: (v) => v.toFixed(2),
  },

  {
    kind: 'toggle',
    key: 'showWave',
    label: 'Travelling wave (Re ψ)',
    group: 'visuals',
    visibleIf: (p) => !isScale(p),
  },
  {
    kind: 'toggle',
    key: 'showStanding',
    label: 'Standing component',
    group: 'visuals',
    visibleIf: (p) => !isScale(p),
    help: 'Adds the wrap-around partner e^{−inθ} with the coherence amplitude Q.',
  },
  {
    kind: 'toggle',
    key: 'showInterference',
    label: 'Phasor buildup + seam',
    group: 'visuals',
    visibleIf: (p) => !isScale(p),
  },
  {
    kind: 'toggle',
    key: 'showGuides',
    label: 'Bohr-allowed radii',
    group: 'visuals',
    visibleIf: (p) => !isScale(p),
    help: 'Dashed circles at every resonant radius rₙ = nλ/2π.',
  },
  {
    kind: 'slider',
    key: 'amplitude',
    label: 'Radial amplitude',
    group: 'visuals',
    min: 0.05,
    max: 2,
    step: 0.01,
    visibleIf: (p) => !isScale(p),
    format: (v) => `×${v.toFixed(2)}`,
  },
  {
    kind: 'slider',
    key: 'thickness',
    label: 'Stroke weight',
    group: 'visuals',
    min: 0.6,
    max: 6,
    step: 0.1,
    unit: 'px',
    visibleIf: (p) => !isScale(p),
    format: (v) => v.toFixed(1),
  },
  {
    kind: 'slider',
    key: 'spinPhase',
    label: 'Carrier phase φ₀',
    group: 'visuals',
    min: 0,
    max: 6.2832,
    step: 0.005,
    unit: 'rad',
    visibleIf: (p) => !isScale(p),
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'resScale',
    label: 'Render scale',
    group: 'visuals',
    min: 0.5,
    max: 1.75,
    step: 0.05,
    visibleIf: (p) => !isScale(p),
    help: 'Backing-store multiplier — drop it if the frame budget is tight.',
    format: (v) => `${v.toFixed(2)}×`,
  },

  {
    kind: 'select',
    key: 'massChoice',
    label: 'Beam',
    group: 'fields',
    visibleIf: isScale,
    options: MASS_PRESETS.map((m) => ({ value: m.id, label: m.label })),
    help: 'Selecting a preset loads its real mass and velocity; use Custom to drive the sliders.',
  },
  {
    kind: 'slider',
    key: 'logMass',
    label: 'Mass',
    group: 'fields',
    min: -34,
    max: 0,
    step: 0.0005,
    visibleIf: isScale,
    help: 'Logarithmic: one tick = one decade of mass.',
    format: (v) => massLabel(Math.pow(10, v)),
  },
  {
    kind: 'slider',
    key: 'logSpeed',
    label: 'Speed',
    group: 'fields',
    min: 0,
    max: 8.48,
    step: 0.002,
    visibleIf: isScale,
    help: 'Logarithmic; the top of the range is 0.98 c.',
    format: (v) => speedLabel(Math.pow(10, v)),
  },
  {
    kind: 'slider',
    key: 'logSlit',
    label: 'Aperture a',
    group: 'fields',
    min: -4,
    max: 3,
    step: 0.002,
    visibleIf: isScale,
    help: 'Slit / grating period in nm, on a log scale from 0.1 pm to 1 mm.',
    format: (v) => formatLength(Math.pow(10, v) * 1e-9),
  },
];

/** Compact one-line state summary used by cards and OG previews. */
export function describeDeBroglie(p: SimParams): string {
  if (pStr(p, 'tab', 'orbit') === 'scale') {
    const d = deBroglieSI(p);
    return `${massLabel(d.massKg)} at ${speedLabel(d.speedMS)} ⇒ λ = ${formatLength(d.lambdaM)}, ${
      d.ratio > 1e-3 ? 'diffracts' : 'does not diffract'
    } at a ${formatLength(d.apertureM)} aperture`;
  }
  const r = ringState(p);
  return `n = ${r.n.toFixed(2)} windings of λ = ${r.lamAU.toFixed(1)} a₀ on a ${r.rAU.toFixed(1)} a₀ orbit`;
}
