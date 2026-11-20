import type { SimParams } from '@/simulations/types';

/**
 * Spectral Transitions & Dipole Radiation — canonical state (dependency-free).
 *
 * `laserRel` is ω_L/ω₁₂, so 1 is exact resonance and the detuning is
 * Δ = (laserRel − 1)·ω₁₂. `intensity` is the field amplitude E₀ in units of
 * 10⁶ V/m, `damping` the upper-state decay rate γ in units of 10⁸ s⁻¹ and
 * `timeDilation` the number of physical nanoseconds simulated per wall second.
 *
 * The keys below the divider are written *by* the running simulation (~4×/s) so
 * that the telemetry pill, which only sees this map, can report live numbers.
 * `replay` is a flip-flop: toggling it re-arms the shot without touching the
 * physics, which is what the guided tours use to fire a fresh π pulse.
 */
export const dipoleDefaults: SimParams = {
  iN: 1,
  iL: 0,
  iM: 0,
  fN: 2,
  fL: 1,
  fM: 0,

  laserRel: 1, // ω_L / ω₁₂
  intensity: 1, // E₀ in units of 10⁶ V/m
  damping: 0, // γ in units of 10⁸ s⁻¹
  timeDilation: 0.02, // physical ns per wall second
  nuclearZ: 1,

  render: 'both', // cloud | bloch | both (stage keys 1 / 2 / 3)
  showField: true,
  cloudOpacity: 1,
  phaseColor: true,
  integrator: 'rk4', // rk4 | exact

  // Diagnostics
  probeForbidden: false,
  probeCase: 'ls-2s',

  /* ---- live mirrors ------------------------------------------------------ */
  pulseArea: 0, // ∫|Ω_R|dt, rad
  p2Live: 0, // P₂ right now
  tLiveNs: 0, // physical time since re-arm, ns
  dipoleLive: 0, // ⟨d⟩, e·a₀
  emittedLive: 0, // population lost to γ
  subSteps: 0, // RK4 substeps used in the last frame
  integratorLive: 'rk4',
  replay: false,
};

export default dipoleDefaults;
