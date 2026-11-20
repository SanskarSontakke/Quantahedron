import type { SimParams } from '@/simulations/types';

/**
 * Stern–Gerlach Spin & Bloch Sphere Lab — canonical state (dependency-free).
 *
 * Each stage carries an axis — either a Cartesian select ('x' | 'y' | 'z') or
 * 'custom' with azimuth/elevation — plus two beam-block flags. `spinTheta` /
 * `spinPhi` are the |χ⟩ = cos(θ/2)|↑⟩ + e^{iφ}sin(θ/2)|↓⟩ preparation angles, so
 * a permalink reproduces the exact beam split, and `seed` pins the Monte-Carlo
 * shot noise of the beam counter.
 *
 * `larmor` is the guide field in millitesla; the animation shows one full turn
 * per 1/`precessionFreq` seconds when the field equals the 20 mT reference, so
 * the visible phase is a documented slow-motion replay of γ_e·B·t_flight turns.
 *
 * The keys below the divider are written *by* the running bench (~4×/s) so the
 * telemetry pill — which only sees this map — can report live numbers.
 * `reroll` is a flip-flop: toggling it re-fires the beam with a new seed, which
 * is also how the guided tours deal a fresh set of shots.
 */
export const sternGerlachDefaults: SimParams = {
  stages: 3,

  a1Axis: 'z',
  a1CustomAz: 0,
  a1CustomEl: 45,
  block1Up: false,
  block1Down: true,

  a2Axis: 'x',
  a2CustomAz: 0,
  a2CustomEl: 0,
  block2Up: false,
  block2Down: true,

  a3Axis: 'z',
  a3CustomAz: 0,
  a3CustomEl: 0,
  block3Up: false,
  block3Down: false,

  spinTheta: 0,
  spinPhi: 0,

  larmor: 0, // guide field, mT
  precessionFreq: 0.8, // display turns per wall second at 20 mT
  beamCount: 900,
  seed: 7,

  render: 'both', // beam | bloch | both (stage keys 1 / 2 / 3)
  showBloch: true,
  showTrajectories: true,
  magnetGap: 0.5,
  fieldGradient: 1,

  /* ---- live mirrors ------------------------------------------------------ */
  phaseTurnsLive: 0, // accumulated display phase, turns
  transmittedLive: 0, // analytic weight leaving the last analyser
  sxLive: 0, // ⟨σx⟩ of the state inside the beam right now
  syLive: 0, // ⟨σy⟩
  szLive: 0, // ⟨σz⟩
  activeStageLive: 0, // 1-based analyser the packet is crossing (0 = source)
  detectedLive: 0, // atoms registered on the detectors in the last run
  shotsLive: 0, // atoms fired in the last run
  reroll: false,
};

export default sternGerlachDefaults;
