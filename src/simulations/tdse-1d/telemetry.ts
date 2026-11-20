/**
 * Sim 3 — telemetry.
 *
 * The contract for `telemetry(p)` is a pure function of the stored parameters, so
 * this panel carries everything that is *analytically* true of the configuration:
 * resolution, the stability ratio, the analytic packet energy and spreading time,
 * the evanescent decay constant under the barrier. Instantaneous measured numbers
 * (t, ‖ψ‖, norm drift, ⟨x⟩, ⟨p⟩, ⟨E⟩, most-occupied level, FPS) live on the canvas
 * HUD and in the Solver tab, which read the live frame directly.
 */

import type { SimParams, TelemetryItem } from '@/simulations/types';
import { pBool, pNum, pStr } from '@/store/useSimStore';
import { BOX_AU, gridNOf, potentialSig } from './model';

const round = (v: number, d = 3): string => v.toFixed(d);

export function tdseTelemetry(p: SimParams): TelemetryItem[] {
  const n = gridNOf(p);
  const dx = BOX_AU / n;
  const dt = pNum(p, 'dt', 0.0004);
  const spf = Math.max(1, Math.round(pNum(p, 'stepsPerFrame', 3)));
  const k = pNum(p, 'k0', 60) / BOX_AU;
  const energy = 0.5 * k * k; // ℏ = m = 1
  const v0 = pStr(p, 'potential', 'double') === 'kronig' ? pNum(p, 'latticeDepth', 6) : pNum(p, 'V0', 8);
  const under = Math.max(0, v0 - energy);
  const kappa = Math.sqrt(2 * under);
  const gap = pNum(p, 'barrierGap', 0.18) * BOX_AU;
  const sigma0 = pNum(p, 'sigma', 0.05) * BOX_AU;
  // Free-Gaussian spreading: σ(t) = σ₀ √(1 + (ħt/2mσ₀²)²).
  const spreadTime = 2 * sigma0 * sigma0;
  const doubleTime = spreadTime * Math.sqrt(3);
  // Energy actually populated by the packet: kinetic mean plus its σ₀ zero point.
  const eState = energy + 1 / (8 * sigma0 * sigma0);
  const phase = dt * (v0 + eState);
  // Top of the central-difference lattice band, ℏ = m = 1 — the stiffest mode CN sees.
  const bandTop = 4 / (dx * dx);

  return [
    {
      label: 'Propagator',
      value: 'Crank–Nicolson',
      hint: '(1 + iΔtH/2)⁻¹(1 − iΔtH/2) — exactly unitary',
      tone: 'accent',
    },
    {
      label: 'Grid',
      value: `N = ${n}`,
      hint: `dx = ${round(dx, 4)} a.u. over [−${(BOX_AU / 2).toFixed(1)}, +${(BOX_AU / 2).toFixed(1)}]`,
    },
    {
      label: 'Time step',
      value: `${dt.toExponential(2)} a.u.`,
      hint: `${(spf * 60).toLocaleString()} steps/s → ${(spf * dt * 60).toFixed(3)} a.u./s of physical time`,
    },
    {
      label: 'Δt·E(occupied)',
      value: phase.toFixed(4),
      hint:
        phase < 0.25
          ? `≪ 1: the wavepacket phase is resolved (band top would need Δt < ${(0.25 / bandTop).toExponential(1)})`
          : 'undersampled — reduce Δt or increase N',
      tone: phase < 0.25 ? 'good' : 'warn',
    },
    {
      label: 'Packet ⟨E⟩₀',
      value: round(energy + 1 / (8 * sigma0 * sigma0), 3),
      hint: `k = ${round(k, 3)} → ℏ²k²/2m = ${round(energy, 3)}, plus the σ₀ zero-point 1/8σ₀² = ${round(1 / (8 * sigma0 * sigma0), 3)}`,
    },
    {
      label: 'κ under V₀',
      value: kappa > 0 ? round(kappa, 3) : '0 (over-barrier)',
      hint:
        kappa > 0
          ? `√(2m(V₀−E)) = ${round(kappa, 3)} ⇒ tail ∝ e^(−κx), one decade per ${(Math.LN10 / kappa).toFixed(2)} a.u.`
          : 'the packet is above the barrier: propagating, not evanescent',
      tone: kappa > 0 ? 'default' : 'accent',
    },
    {
      label: 'Gamow factor',
      value: kappa > 0 ? Math.exp(-2 * kappa * gap).toExponential(2) : '—',
      hint: `e^(−2κ·gap) across the ${round(gap, 2)} a.u. central barrier`,
    },
    {
      label: 'Spreading',
      value: `σ(t) = σ₀√(1 + (t/${round(spreadTime, 2)})²)`,
      hint: `doubles at t ≈ ${round(doubleTime, 2)} a.u. (σ₀ = ${round(sigma0, 3)} a.u.)`,
    },
    {
      label: 'Sponge',
      value: pNum(p, 'capWidth', 0.06) <= 0 ? 'off — hard walls' : `${(pNum(p, 'capWidth', 0.06) * 100).toFixed(1)} %`,
      hint:
        pNum(p, 'capWidth', 0.06) <= 0
          ? 'norm is conserved to machine precision and the packet recurs'
          : `W peak ≈ ${(pNum(p, 'capStrength', 0.35) * 250).toFixed(0)} a.u. ⇒ ψ ← e^(−Δt·W/ℏ)ψ`,
      tone: pNum(p, 'capWidth', 0.06) <= 0 ? 'default' : 'accent',
    },
    {
      label: 'Eigen solve',
      value: `${Math.round(pNum(p, 'eigenCount', 12))} levels`,
      hint: pBool(p, 'showEigen', true) || pStr(p, 'view', 'density') === 'spectrum'
        ? 'Sturm bisection + inverse iteration on the tridiagonal H'
        : 'not requested by the current view',
    },
    {
      label: 'Configuration',
      value: potentialSig(p).split('|')[0],
      hint: `hash ${Math.abs(hashCode(potentialSig(p)))
        .toString(36)
        .slice(0, 6)} — identical hashes share a propagator`,
    },
  ];
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export default tdseTelemetry;
