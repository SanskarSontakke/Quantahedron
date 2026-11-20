/**
 * atom.ts — the driven two-level atom integrator.
 *
 * Physics
 * -------
 * Hydrogenic manifolds |i⟩, |f⟩ with E_f − E_i = ħω₀ are coupled by a linearly
 * polarised laser E(t) = E₀ cos(ω_L t) ẑ through H_int = −d̂·E(t), d̂ = −e r̂:
 *
 *   iħ ∂ₜ (c_i, c_f)ᵗ = [H₀ + H_int(t)] (c_i, c_f)ᵗ,
 *   H_int,fi = −⟨f| e ẑ |i⟩ E₀ cos(ω_L t) = −ħ Ω_R cos(ω_L t)  (Ω_R ≡ d_fi E₀/ħ).
 *
 * Going to the interaction picture (c_k = b_k e^{−iω_k t}) and dropping the
 * counter-rotating term e^{+i(ω₀+ω_L)t} — the rotating-wave approximation,
 * good to Ω_R/ω_L ≈ 10⁻⁶ at every field this UI reaches — leaves a *time
 * independent* Hamiltonian for the slowly varying envelopes:
 *
 *   H_eff = ½ ( Ω_R σ_x − Δ σ_z ),  Δ = ω_L − ω₀,  basis (b_g, b_e)
 *
 * which is exactly a spin precessing about the vector (Ω_R, 0, −Δ). Two
 * integrators are provided for that ODE:
 *
 *   `stepRK4`   — classic fixed-step 4th-order Runge–Kutta (sub-stepped by the
 *                 caller so Ω_gen·dt_sub stays ≲ 0.25 rad),
 *   `stepExact` — the closed-form exponential exp(−i H_eff dt) obtained from the
 *                 SU(2) rotation `rotationMatrix` in engine/physics/blochSpin.
 *
 * The Canvas uses RK4 and automatically upgrades to `stepExact` when the frame
 * is too long for the sub-step budget, which keeps the simulation exact for
 * every slider combination instead of going unstable.
 */

import type { Spinor, Vec3 } from '@/engine/physics/blochSpin';
import { applyMat2, blochVector, normalizeSpinor, rotationMatrix, spinor, v3 } from '@/engine/physics/blochSpin';
import { BOHR_RADIUS_M, HARTREE_EV, cx } from '@/engine/physics/constants';

/** Re-export so the sim reads physical scales from one place. */
export { BOHR_RADIUS_M, HARTREE_EV };

/** a₀ (m) · (1/ħ in eV·s) ⇒ conversion factor (rad·s⁻¹) per (V·m⁻¹·e·a₀). */
export const FIELD_TO_RABI = BOHR_RADIUS_M / 6.582119569e-16;

export interface DriveConfig {
  /** ω₀ = (E_f − E_i)/ħ, rad·s⁻¹. */
  omega0: number;
  /** Δ = ω_L − ω₀, rad·s⁻¹. */
  delta: number;
  /** Ω_R = d_fi·E₀/ħ, rad·s⁻¹ (signed; only |Ω_R| affects populations). */
  rabi: number;
  /** Phenomenological upper-state decay rate γ = 1/τ, s⁻¹. */
  gamma: number;
}

export interface DriveState {
  /** Slowly varying envelopes of |i⟩ and |f⟩. */
  amp: Spinor;
  /** Physical time in seconds since the run started. */
  t: number;
  /** Pulse area ∫|Ω_R| dt, radians. */
  pulseArea: number;
  /** Population lost to the decay channel (equals 0 while γ = 0). */
  emitted: number;
}

export function initialDriveState(): DriveState {
  return { amp: spinor(cx(1), cx(0)), t: 0, pulseArea: 0, emitted: 0 };
}

export function resetDriveState(s: DriveState): void {
  s.amp = spinor(cx(1), cx(0));
  s.t = 0;
  s.pulseArea = 0;
  s.emitted = 0;
}

/** Generalised Rabi frequency Ω = √(Ω_R² + Δ²) (rad·s⁻¹). */
export function generalizedRabi(cfg: DriveConfig): number {
  return Math.hypot(cfg.rabi, cfg.delta);
}

/**
 * Analytic benchmark: P₂(t) = (Ω_R²/Ω²) sin²(Ω t / 2) for a system that starts
 * in |i⟩ with no decay. Used both to validate the integrator and to draw the
 * dashed envelope on the population chart.
 */
export function rabiFormula(cfg: DriveConfig, t: number): number {
  const om = generalizedRabi(cfg);
  if (om < 1e-9) return 0;
  const s = Math.sin(0.5 * om * t);
  return (cfg.rabi * cfg.rabi / (om * om)) * s * s;
}

/** Precession (Bloch) vector Ω⃗ = (Ω_R, 0, −Δ)/… as a plain Vec3, rad·s⁻¹. */
export function precessionVector(cfg: DriveConfig): Vec3 {
  return v3(cfg.rabi, 0, -cfg.delta);
}

/** Derivative of the envelope amplitudes: ∂ₜψ = −i H_eff ψ with ħ = 1. */
function deriv(a: Spinor, cfg: DriveConfig): Spinor {
  const h01 = cfg.rabi * 0.5;
  const h00 = -cfg.delta * 0.5;
  const h11 = cfg.delta * 0.5;
  // −i·(H ψ)
  const gRe = h00 * a.up.re + h01 * a.down.re;
  const gIm = h00 * a.up.im + h01 * a.down.im;
  const eRe = h01 * a.up.re + h11 * a.down.re;
  const eIm = h01 * a.up.im + h11 * a.down.im;
  return spinor(cx(gIm, -gRe), cx(eIm, -eRe));
}

/** One classic RK4 step of length `dt` on the driven envelope amplitudes. */
export function stepRK4(s: DriveState, cfg: DriveConfig, dt: number): void {
  const a0 = s.amp;
  const k1 = deriv(a0, cfg);
  const k2 = deriv(spinorAddScaled(a0, k1, dt / 2), cfg);
  const k3 = deriv(spinorAddScaled(a0, k2, dt / 2), cfg);
  const k4 = deriv(spinorAddScaled(a0, k3, dt), cfg);
  const up = combine(a0.up, k1.up, k2.up, k3.up, k4.up, dt);
  const down = combine(a0.down, k1.down, k2.down, k3.down, k4.down, dt);
  s.amp = spinor(up, down);
  s.t += dt;
  s.pulseArea += Math.abs(cfg.rabi) * dt;
}

function combine(a: { re: number; im: number }, k1: { re: number; im: number }, k2: { re: number; im: number }, k3: { re: number; im: number }, k4: { re: number; im: number }, dt: number) {
  const w = dt / 6;
  return cx(a.re + w * (k1.re + 2 * k2.re + 2 * k3.re + k4.re), a.im + w * (k1.im + 2 * k2.im + 2 * k3.im + k4.im));
}

function spinorAddScaled(a: Spinor, k: Spinor, h: number): Spinor {
  return spinor(cx(a.up.re + h * k.up.re, a.up.im + h * k.up.im), cx(a.down.re + h * k.down.re, a.down.im + h * k.down.im));
}

/**
 * Exact propagator for one step: exp(−i H_eff dt) = R(Ω̂, Ω_gen·dt).
 * Unconditionally stable — used when the sub-step budget is exhausted.
 */
export function stepExact(s: DriveState, cfg: DriveConfig, dt: number): void {
  const om = generalizedRabi(cfg);
  if (om < 1e-9 || dt === 0) {
    s.t += dt;
    return;
  }
  const axis = v3(cfg.rabi / om, 0, -cfg.delta / om);
  s.amp = applyMat2(s.amp, rotationMatrix(axis, om * dt));
  s.t += dt;
  s.pulseArea += Math.abs(cfg.rabi) * dt;
}

/**
 * Apply phenomenological spontaneous decay over `dt`: the upper amplitude loses
 * e^{−γ dt/2} of its magnitude and the population is returned to |i⟩ incoherently.
 */
export function applyDecay(s: DriveState, cfg: DriveConfig, dt: number): void {
  if (cfg.gamma <= 0 || dt <= 0) return;
  const pE = s.amp.down.re * s.amp.down.re + s.amp.down.im * s.amp.down.im;
  const pG = s.amp.up.re * s.amp.up.re + s.amp.up.im * s.amp.up.im;
  if (pE <= 1e-18) return;
  const norm = pG + pE;
  const keep = Math.exp(-cfg.gamma * dt);
  const pE2 = pE * keep;
  const pG2 = norm - pE2;
  const nE = Math.sqrt(pE);
  const nG = Math.sqrt(pG);
  // Decay returns the atom to |i⟩ incoherently: populations move, phases follow
  // the amplitude they came from (a rate-equation stand-in for the Lindblad term).
  const gUnit = nG > 1e-15 ? { re: s.amp.up.re / nG, im: s.amp.up.im / nG } : { re: 1, im: 0 };
  const eUnit = { re: s.amp.down.re / nE, im: s.amp.down.im / nE };
  const a = Math.sqrt(pG2);
  const b = Math.sqrt(pE2);
  s.amp = spinor(cx(gUnit.re * a, gUnit.im * a), cx(eUnit.re * b, eUnit.im * b));
  s.emitted += pE - pE2;
}

/** How many RK4 sub-steps this frame needs to keep Ω_gen·dt_sub ≤ budget. */
export function requiredSubSteps(dt: number, cfg: DriveConfig, budget = 0.25, max = 4096): number {
  const rate = Math.max(generalizedRabi(cfg), cfg.gamma);
  if (rate <= 0 || dt <= 0) return 1;
  return Math.max(1, Math.min(max, Math.ceil((dt * rate) / budget)));
}

export interface AdvanceReport {
  subSteps: number;
  dtSub: number;
  method: 'rk4' | 'exact';
}

/** Advance the whole frame, choosing the integrator automatically. */
export function advance(
  s: DriveState,
  cfg: DriveConfig,
  dt: number,
  opts: { forceMethod?: 'rk4' | 'exact'; maxSubSteps?: number } = {},
): AdvanceReport {
  if (dt <= 0) return { subSteps: 0, dtSub: 0, method: opts.forceMethod ?? 'rk4' };
  const max = opts.maxSubSteps ?? 4096;
  const need = requiredSubSteps(dt, cfg, 0.25, max);
  const method: 'rk4' | 'exact' =
    opts.forceMethod ?? (need >= max ? 'exact' : 'rk4');
  const n = method === 'exact' ? 1 : need;
  const dtSub = dt / n;
  for (let i = 0; i < n; i++) {
    if (method === 'exact') stepExact(s, cfg, dt);
    else stepRK4(s, cfg, dtSub);
    applyDecay(s, cfg, dtSub);
  }
  return { subSteps: n, dtSub, method };
}

/** Populations, always normalised so the chart cannot drift above 1. */
export function populations(s: DriveState): { p1: number; p2: number } {
  const u = s.amp.up;
  const d = s.amp.down;
  const a = u.re * u.re + u.im * u.im;
  const b = d.re * d.re + d.im * d.im;
  const tot = a + b;
  if (tot < 1e-12) return { p1: 1, p2: 0 };
  return { p1: a / tot, p2: b / tot };
}

/**
 * Bloch-sphere coordinates of the driven atom.
 * u = ⟨σ_x⟩, v = ⟨σ_y⟩, w = ⟨σ_z⟩ = P₁ − P₂, so full inversion is w = −1.
 */
export function blochFromState(s: DriveState): { u: number; v: number; w: number } {
  const r = blochVector(normalizeSpinor(s.amp));
  return { u: r[0], v: r[1], w: r[2] };
}

/**
 * Lab-frame relative phase between the two manifolds at display time `tau`.
 * c_k(t) = b_k e^{−iω_k t}: the population sloshes at ω₀, which is why the
 * cloud renderer is driven by a slow-motion optical clock instead of dt.
 */
export function labPhase(omega0: number, tau: number): number {
  return -omega0 * tau;
}

/** Field amplitude E₀ (V/m) from the `intensity` slider (units of 10⁶ V/m). */
export const fieldAmplitude = (intensity: number): number => intensity * 1e6;

/** Plane-wave intensity I = ½ c ε₀ E₀² in W/cm² for the read-out. */
export function intensityWCm2(eVm: number): number {
  const c = 299792458;
  const eps0 = 8.8541878128e-12;
  return (0.5 * c * eps0 * eVm * eVm) / 1e4;
}
