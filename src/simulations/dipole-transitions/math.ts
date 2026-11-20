/**
 * Dipole Transitions — synchronized live math drawer.
 *
 * Every string here is generated from `computeAtom(p)`, so the TeX shows the
 * numbers that are actually being integrated: change ℓ and the selection-rule
 * verdict, the angular factor, the dipole element and the challenge answers all
 * move with it.
 */

import type { MathBlock, SimChallenge, SimMathContent, SimParams } from '@/simulations/types';
import { HBAR_EV_S, transitionWavelengthNm } from '@/engine/physics/constants';
import { pNum, pStr } from '@/store/useSimStore';
import { FIELD_TO_RABI } from './atom';
import { computeAtom } from './physics';
import { angularElement, dipoleZ, RULE_CASES } from './dipole';

/** Field amplitude (V/m) that delivers a π pulse in `tNs` nanoseconds. */
export function piPulseField(tNs: number, absD: number): number {
  if (absD <= 0) return Infinity;
  return Math.PI / (Math.max(1e-9, tNs) * 1e-9) / (absD * FIELD_TO_RABI);
}

const eV = (v: number): string => `${v.toFixed(4)} eV`;
const per = (v: number): string => `${v >= 1e4 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(4) : v.toFixed(3)}`;
const nm = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(2)} nm` : 'degenerate');

export function dipoleMath(p: SimParams): SimMathContent {
  const a = computeAtom(p);
  const ang = a.element.angular;
  const exact =
    a.Z === 1 && a.i.n === 1 && a.i.l === 0 && a.i.m === 0 && a.f.n === 2 && a.f.l === 1 && a.f.m === 0;
  const ceiling = a.omegaGen > 1e-9 ? (a.rabi * a.rabi) / (a.omegaGen * a.omegaGen) : 0;
  const ePi20 = piPulseField(20, a.absD);
  const iWCm2 = (0.5 * 299792458 * 8.8541878128e-12 * ePi20 * ePi20) / 1e4;

  const probeId = pStr(p, 'probeCase', 'ls-2s');
  const probe = RULE_CASES.find((r) => r.id === probeId) ?? RULE_CASES[1];
  const [pn, pl, pm] = probe.states.i;
  const [qn, ql, qm] = probe.states.f;
  const probeAng = angularElement(pl, pm, ql, qm);
  const probeEl = dipoleZ(pn, pl, pm, qn, ql, qm, a.Z);

  const formula: MathBlock[] = [
    {
      tex: 'i\\hbar\\,\\partial_t|\\psi\\rangle = \\big(\\hat H_0 - \\hat{\\mathbf d}\\cdot\\mathbf E_0\\cos\\omega_L t\\big)|\\psi\\rangle,\\qquad \\hat{\\mathbf d}=-e\\,\\hat{\\mathbf r}',
      display: true,
      note: 'Length-gauge dipole coupling: the only term the laser switches on.',
    },
    {
      tex: `|\\psi(t)\\rangle = c_i\\,e^{-i\\omega_i t}|i\\rangle + c_f\\,e^{-i\\omega_f t}|f\\rangle,\\qquad \\omega_{12}=${per(a.omega0)}\\ \\mathrm{s^{-1}}`,
      display: true,
      note: `${a.iLabel} sits at ${eV(a.eI)}, ${a.fLabel} at ${eV(a.eF)} — spacing ${eV(a.deltaE)}.`,
    },
    {
      tex: `d_{fi}=\\langle ${a.fLabel}|\\hat z|${a.iLabel}\\rangle=${a.dFi.toFixed(6)}\\ e\\,a_0${exact ? '\\ \\left(=\\tfrac{128\\sqrt{2}}{243}\\right)' : ''}`,
      display: true,
      note: `Angular factor ${ang.closed.toFixed(6)} closed-form vs ${ang.numeric.toFixed(6)} by 24×32 quadrature (|Δ| = ${ang.error.toExponential(2)}); radial ∫R_f R_i r³ dr = ${a.element.radial.toFixed(6)} a₀⁴.`,
    },
    {
      tex: `P_2(t)=\\frac{\\Omega_R^{2}}{\\Omega^{2}}\\sin^{2}\\!\\Big(\\frac{\\Omega t}{2}\\Big),\\qquad \\Omega_R=\\frac{d_{fi}E_0}{\\hbar}=${per(a.rabi)}\\ \\mathrm{s^{-1}},\\quad \\Omega=\\sqrt{\\Omega_R^{2}+\\Delta^{2}}=${per(a.omegaGen)}\\ \\mathrm{s^{-1}}`,
      display: true,
      note: `Δ = ${per(a.detuning)} s⁻¹, so the inversion ceiling is Ω_R²/Ω² = ${(100 * ceiling).toFixed(2)}%.`,
    },
  ];

  const readout: { label: string; value: string }[] = [
    { label: 'ΔE', value: `${a.deltaE.toFixed(5)} eV` },
    { label: 'λ₁₂', value: nm(a.wavelengthNm) },
    { label: 'laser λ', value: Number.isFinite(a.laserNm) ? `${a.laserNm.toFixed(1)} nm` : '—' },
    { label: 'ħ', value: `${HBAR_EV_S.toExponential(3)} eV·s` },
    { label: 'E₀', value: `${a.eField.toExponential(3)} V/m` },
    { label: 'I', value: `${a.intensityWCm2.toExponential(3)} W/cm²` },
    { label: 'T_Rabi', value: `${per(a.periodNs)} ns` },
    { label: 't_π', value: Number.isFinite(a.tPiNs) ? `${per(a.tPiNs)} ns` : '∞ (dark)' },
    { label: 'τ = 1/γ', value: Number.isFinite(a.lifetimeNs) ? `${a.lifetimeNs.toFixed(2)} ns` : '∞' },
    { label: 'Ω_R/ω₁₂', value: a.rwaRatio.toExponential(2) },
    { label: 'Δℓ / Δm', value: `${ang.deltaL} / ${ang.deltaM}` },
    { label: 'selection rule', value: a.element.verdict },
  ];

  const phaseLegend = a.phaseColor
    ? `Hue carries $\\arg\\Psi$ on the shared twilight wheel (rose at $0$, indigo at $\\pm\\pi$, the sign of $\\operatorname{Im}\\Psi$ setting the direction of travel) and luminance carries $|\\Psi|^2$ with $\\gamma = 2.4$. The two lobes of $\\Psi = b_i\\psi_i + b_f e^{-i\\omega_{12}\\tau}\\psi_f$ change colour as the relative phase winds: that is the charge sloshing along $\\hat z$ at $\\omega_{12} = ${per(a.omega0)}\\ \\mathrm{s^{-1}}$, stretched by $\\lfloor ${Math.round(a.slowMotion).toLocaleString('en-US')} \\rfloor\\times$ so the eye can follow it.`
    : `Phase wheel off: luminance alone encodes $|\\Psi|^2$ on a grey ramp, so lobe heights can be compared quantitatively. The relative phase still advances at $\\omega_{12}$, so the cloud keeps sloshing.`;

  const intuition = `A polarised laser does not shove an electron from one orbit into another — it drives a coherent beat between two stationary states. In the rotating frame the density is $|\\Psi|^2 = |b_i\\psi_i|^2 + |b_f\\psi_f|^2 + 2\\,\mathrm{Re}\\big(b_i^{*}b_f\,\psi_i^{*}\psi_f\,e^{-i\omega_{12}t}\\big)$ and only the interference term moves. It is an oscillating dipole $\\langle d\\rangle = 2\\,\\mathrm{Re}(b_i^{*}b_f)\\,d_{fi}$, of peak size ${a.absD.toFixed(3)}\\ e a_0$ when the two levels are equally populated and oscillating at $\\omega_{12}$ — and an oscillating dipole is exactly what radiates: absorption and stimulated emission are the two directions of the same bookkeeping. Whether $d_{fi}$ exists at all is settled before the field is switched on — $\\hat z$ is odd under $\\hat{\\mathbf r}\\to-\\hat{\\mathbf r}$ while $|n\\ell m\\rangle$ has parity $(-1)^\\ell$, so the integrand is odd unless $\\Delta\\ell$ is odd. Two levels plus a monochromatic drive are mathematically identical to a spin-$\\tfrac12$ in a magnetic field: the Bloch vector $(u,v,w) = \\langle\\sigma_x,\\sigma_y,\\sigma_z\\rangle$ precesses about $\\vec\\Omega = (\\Omega_R,0,-\\Delta)$ at rate $\\Omega = \\sqrt{\\Omega_R^2+\\Delta^2}$, so on resonance it walks pole to pole (a pulse area $\\int\\Omega_R dt = \\pi$ inverts it) and off resonance it merely cones around $w$, capped at $\\Omega_R^2/\\Omega^2 = ${(100 * ceiling).toFixed(1)}\\%$ for the present detuning $\\omega_L/\\omega_{12} = ${pNum(p, 'laserRel', 1).toFixed(3)}.`;

  const derivation: SimMathContent['derivation'] = [
    {
      title: 'From the dipole Hamiltonian to Rabi flopping',
      steps: [
        {
          text: 'Work in the length gauge, $H_{\\mathrm{int}}(t) = -\\hat{\\mathbf d}\\cdot\\mathbf E(t) = e\\,\\hat{\\mathbf r}\\cdot\\mathbf E_0\\cos\\omega_L t$, and expand the state in the exact hydrogenic eigenbasis of $\\hat H_0$, $|\\psi\\rangle = \\sum_k c_k(t)e^{-i\\omega_k t}|n_k\\ell_k m_k\\rangle$. Projecting the Schrödinger equation onto $\\langle f|$ gives an exact, infinite coupled-mode system:',
          math: [
            {
              tex: 'i\\hbar\\,\\dot c_f = \\sum_k c_k\\,e^{i(\\omega_f-\\omega_k)t}\\,\\langle f|H_{\\mathrm{int}}(t)|k\\rangle',
              display: true,
            },
          ],
        },
        {
          text: `Because $z = r\\cos\\vartheta$, each element factorises into an angular and a radial integral. The angular one is a Gauss integral of three spherical harmonics, equal by Wigner–Eckart to $\\begin{pmatrix}\\ell_f&1&\\ell_i\\\\-m_f&0&m_i\\end{pmatrix}$ times a $6j$ symbol, which vanishes unless $\\boxed{\\Delta\\ell=\\pm1}$ and $\\boxed{\\Delta m = 0}$ for $\\pi$ ($\\hat z$-polarised) light ($\\Delta m = \\pm1$ for $\\sigma^{\\pm}$). The physics is parity: $|n\\ell m\\rangle$ has parity $(-1)^\\ell$ and $\\hat z$ is odd, so the integrand is odd — and its integral zero — unless $\\ell'-\\ell$ is odd. For the ladder operators the closed form is`,
          math: [
            {
              tex: '\\langle \\ell+1,m|\\cos\\vartheta|\\ell,m\\rangle = \\sqrt{\\frac{(\\ell+m+1)(\\ell-m+1)}{(2\\ell+3)(2\\ell+1)}},\\qquad \\langle \\ell-1,m|\\cos\\vartheta|\\ell,m\\rangle = \\sqrt{\\frac{(\\ell+m)(\\ell-m)}{(2\\ell-1)(2\\ell+1)}}',
              display: true,
            },
            {
              tex: `\\text{live check: } ${ang.closed.toFixed(9)}\\ \\text{closed form vs}\\quad ${ang.numeric.toFixed(9)}\\ \\text{quadrature}`,
              display: true,
            },
          ],
        },
        {
          text: `Those two numbers are independent evaluations of $\\int Y_{\\ell'm'}^{*}\\cos\\vartheta\\,Y_{\\ell m}\\,d\\Omega$ for the current $\\Delta\\ell = ${ang.deltaL}$, $\\Delta m = ${ang.deltaM}$, and they agree to $|\\Delta| = ${ang.error.toExponential(2)}$ — the angular part is not the weak link. The radial part is what the engine integrates numerically, $\\int_0^{\\infty}R_{n'\\ell'}R_{n\\ell}\\,r^{3}\\,dr$ by composite Simpson over $[0,\\max(24,12n_{\\max}^2)]$ with 12 000 panels, giving ${a.element.radial.toFixed(6)} a₀⁴ here. Multiplying the pieces, $d_{fi} = ${a.dFi.toFixed(6)}\\ e a_0$ — ${a.element.allowed ? 'nonzero' : 'identically zero'}: ${a.element.reason.toLowerCase()}.`,
        },
        {
          text: `Retain only the near-resonant pair $(i,f)$, write $\\mathbf E = E_0\\hat z\\cos\\omega_L t$ and drop the counter-rotating term $e^{-i(\\omega_f+\\omega_i)t}$ — the rotating-wave approximation, good to $\\Omega_R/\\omega_{12} = ${a.rwaRatio.toExponential(2)}$. With $\\Delta = \\omega_L - \\omega_{12}$ the envelopes $(b_i,b_f)$ obey a time-independent Schrödinger equation, $i\\hbar\\partial_t\\mathbf b = H_{\\mathrm{eff}}\\mathbf b$, with`,
          math: [
            {
              tex: 'H_{\\mathrm{eff}} = \\frac{\\hbar}{2}\\big(\\Omega_R\\sigma_x - \\Delta\\sigma_z\\big),\\qquad \\Omega_R = \\frac{d_{fi}E_0}{\\hbar}',
              display: true,
            },
          ],
        },
        {
          text: 'An effective Hamiltonian linear in the Pauli matrices generates an SU(2) rotation, so the propagator is known in closed form, $\\exp(-i\\vec\\Omega\\cdot\\vec\\sigma\\,t/2) = \\cos\\tfrac{\\Omega t}{2}\\,I - i\\,\\sin\\tfrac{\\Omega t}{2}\\,(\\hat\\Omega\\cdot\\vec\\sigma)$ with $\\vec\\Omega = (\\Omega_R,0,-\\Delta)$ and $\\Omega = |\\vec\\Omega|$. Starting in $|i\\rangle$ (Bloch vector $+\\hat w$), the excited population is',
          math: [
            {
              tex: 'P_2(t) = \\frac{\\Omega_R^{2}}{\\Omega_R^{2}+\\Delta^{2}}\\,\\sin^{2}\\!\\Big(\\tfrac{1}{2}\\sqrt{\\Omega_R^{2}+\\Delta^{2}}\\;t\\Big),\\qquad w(t) = 1 - 2P_2(t)',
              display: true,
            },
          ],
        },
        {
          text: 'On resonance $\\Delta = 0$ this is $\\sin^2(\\Omega_R t/2)$, so the pulse area $\\int\\Omega_R\\,dt$ reaching $\\pi$ means complete inversion. Watch the convention: some texts write $\\Omega = \\sqrt{\\Omega_R^2 + \\Delta^2/4}$ because they define $\\Omega_R$ with an extra factor of 2; here $\\Omega_R \\equiv d_{fi}E_0/\\hbar$, which makes $\\Omega = \\sqrt{\\Omega_R^2 + \\Delta^2}$ the self-consistent partner of the $H_{\\mathrm{eff}}$ above — the two forms never mix inside one simulation.',
        },
        {
          text: `Finally the observables the viewport paints. The dipole moment of the coherent superposition is $\\langle d\\rangle = d_{ii}|b_i|^2 + d_{ff}|b_f|^2 + 2\\,\mathrm{Re}(b_i^{*}b_f)\\,d_{fi}$; diagonal elements vanish by parity ($s$, $p$, $d$ states have definite parity), so $\\langle d\\rangle = 2\\,\mathrm{Re}(b_i^{*}b_f)\\,d_{fi}$ oscillates at $\\omega_{12}$ and radiates. Spontaneous emission is added phenomenologically as $|b_f|^2 \\to |b_f|^2e^{-\\gamma t}$ with the lost weight returned incoherently to $|i\\rangle$, which is why the engine reports an "emitted" population: currently $\\gamma = ${per(a.gamma)}\\ \\mathrm{s^{-1}}$, a lifetime of ${Number.isFinite(a.lifetimeNs) ? `${a.lifetimeNs.toFixed(2)} ns` : '∞'}, against a Rabi period of ${per(a.periodNs)} ns.`,
        },
      ],
    },
    {
      title: 'Why the dark lines stay dark',
      steps: [
        {
          text: `Pick the probe case ${probe.label}. Its radial integral is $\\int_0^{\\infty}R_{n'\\ell'}R_{n\\ell}\\,r^3\\,dr = ${probeEl.radial.toFixed(5)}\\ a_0^4$ — perfectly finite, which is the trap — but the angular factor is ${probeAng.closed.toFixed(6)} closed-form and ${probeAng.numeric.toExponential(2)} measured by quadrature, so the product ${probeEl.allowed ? 'survives' : 'is exactly zero'}: $|d_{fi}| = ${probeEl.abs.toExponential(2)}\\ e a_0$. ${probe.note}`,
        },
        {
          text: `Because $\\Omega_R = d_{fi}E_0/\\hbar$, a vanishing $d_{fi}$ makes the Rabi frequency zero for *every* field amplitude: $P_2 \\equiv 0$, the pulse area never grows, $\\langle d\\rangle = 0$ and the cloud shows a stationary single-orbital density with no slosh. Operationally that is what "forbidden" means — the drive finds nothing to grab. It is a statement about symmetry, not about energy: nothing prevents a two-photon $1s \\to 2s$ excitation (which is even under parity overall), and $2s$ does decay, but by two-photon emission with $\\tau \\approx 0.13$ s rather than the $1.6$ ns allowed E1 lifetime.`,
        },
        {
          text: `The same rule explains the spectrum's structure. With $\\Delta m = 0$ forced by $\\hat z$-polarisation, ${a.iLabel} can only reach the $m = ${a.i.m}$ members of $\\ell \\pm 1$; that is why Lyman-$\\alpha$ at ${nm(transitionWavelengthNm(1, 2, a.Z))}$ dominates the hydrogen UV while the $1s\\to2s$ one-photon line is absent, and why the Balmer series only starts from the long-lived $n=2$ manifold.`,
        },
      ],
    },
  ];

  const challenge: SimChallenge[] = [
    {
      question: `Make the $\\pi$ pulse on the ${a.iLabel} → ${a.fLabel} line exactly 20 ns long. What $E_0$ do you need, and what plane-wave intensity is that?`,
      hint: 'Require Ω_R = π/(20 ns) = 1.5708×10⁸ s⁻¹, then invert Ω_R = |d_fi|·E₀·(a₀/ħ) with a₀/ħ = 8.0396×10⁴ (rad·s⁻¹) per (V·m⁻¹). Finish with I = ½cε₀E₀² and convert W/m² to W/cm².',
      answer: a.allowed
        ? `Ω_R = π/(20 ns) = 1.5708×10⁸ s⁻¹ together with $|d_{fi}| = ${a.absD.toFixed(6)}\\ ea_0$ gives $E_0 = \\hbar\\Omega_R/|d_{fi}| = ${ePi20.toFixed(1)}\\ \\mathrm{V/m}$, i.e. set the Field E₀ slider to ${(ePi20 / 1e6).toExponential(3)}$ (in units of $10^{6}\\ \\mathrm{V/m}$). The plane wave that goes with it is $I = \\tfrac12 c\\varepsilon_0E_0^2 = ${iWCm2.toFixed(3)}\\ \\mathrm{W/cm^2}$. Sanity anchor: for $1s \\to 2p_0$ ($d_{fi} = 0.744936$) the same number is $E_0 = 2623\\ \\mathrm{V/m}$, $I = 0.912\\ \\mathrm{W/cm^2}$ — an everyday laser pointer, which is why weak fields leave atoms essentially unmoved: at $1\\ \\mathrm{MW/cm^2}$ the same line flops in $\\sim 10\\ \\mathrm{fs}$, faster than an optical cycle, and the rotating-wave approximation ($\\Omega_R/\\omega_{12} = ${a.rwaRatio.toExponential(2)}$ here) starts to fail.`
        : `No field can do it: $d_{fi} = ${a.absD.toExponential(2)}\\ ea_0$ makes $\\Omega_R = d_{fi}E_0/\\hbar = 0$ for all $E_0$, so the pulse area $\\int\\Omega_R dt$ never leaves zero. Pick an allowed pair ($\\Delta\\ell = \\pm1$, $\\Delta m = 0$) first — e.g. 1s → 2p₀ — then the answer is $E_0 = \\hbar\\pi/(|d_{fi}|\\cdot 20\\ \\mathrm{ns})$.`,
      paramKey: 'intensity',
    },
    {
      question: 'Prove to yourself that 1s → 2s is dark without being told. Which three read-outs must you compare, and what do they say?',
      hint: 'Switch on "Probe a dark line" with the 1s→2s case, then look at |d_fi|, at Ω_R, and at the closed-form versus quadrature angular integral on the Math tab.',
      answer: `$\\ell = 0$ for both states, so both have parity $(-1)^0 = +1$ while $\\hat z$ is odd: the integrand $\\psi_{2s}^{*}\\,z\\,\\psi_{1s}$ is odd and its integral vanishes. The engine shows this three ways. (1) Angular factor: closed form $\\langle 00|\\cos\\vartheta|00\\rangle = 0$ against a measured residual of ${probeAng.numeric.toExponential(2)}$ for the 1s→2s probe (the honest number $\\langle 2s|\\hat z|1s\\rangle = ${probeEl.d.toExponential(2)}$). (2) The radial integral stays finite ($\\int R_{20}R_{10}r^3dr = ${probeEl.radial.toFixed(4)}\\ a_0^4$), so the zero genuinely comes from the angle, not from a missing overlap. (3) Dynamics: $\\Omega_R = ${per(a.rabi)}\\ \\mathrm{s^{-1}}$ no matter how far the field slider is pushed, $P_2$ stays at 0, $\\langle d\\rangle = 0$ and the cloud stops sloshing — no coherence, no oscillating dipole, no radiation.`,
      paramKey: 'probeForbidden',
    },
  ];

  return { formula, readout, phaseLegend, intuition, derivation, challenge };
}

export default dipoleMath;
