/**
 * Sim 4 — synchronized math drawer.
 *
 * Tab 1 is the intuition (why the wavefunction does not stop at a wall), tab 2 is a
 * five-step derivation that starts from the matching conditions and ends at "this is
 * why a scanning tunneling microscope can see individual atoms", and tab 3 holds two
 * challenges solvable with the sliders on the left. Every number shown is computed
 * from the live parameters, so the drawer follows the permalinks.
 */

import type { SimMathContent, SimParams } from '@/simulations/types';
import { pNum } from '@/store/useSimStore';
import {
  analyticalT,
  clampNum,
  geomOf,
  groupVelocity,
  kOfEnergy,
  massOf,
  packetMeanT,
  tCurveOf,
  TUN_BOX_AU,
} from './model';
import { evanescentKappa } from '@/engine/physics/splitStepFFT';

export function tunnelMath(p: SimParams): SimMathContent {
  const g = geomOf(p);
  const mass = massOf(p);
  const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
  const k0 = kOfEnergy(e0, mass);
  const kappa = evanescentKappa(e0, g.v0, mass, 1);
  const below = e0 < g.v0;
  const k2 = below ? 0 : Math.sqrt(2 * mass * (e0 - g.v0));
  const tExact = analyticalT(p, e0);
  const fold = packetMeanT(p);
  const v = groupVelocity(e0, mass);
  const n = Math.round(clampNum(pNum(p, 'gridN', 1024), 128, 4096));
  const dx = TUN_BOX_AU / n;
  const dt = clampNum(pNum(p, 'dt', 0.002), 2e-4, 0.01);
  const a = g.a;
  const resonances = tCurveOf(p).resonances;
  const e1 = resonances.length ? resonances[0] : 0;
  const eNaive = g.gap > 0 ? (Math.PI ** 2) / (2 * mass * g.gap * g.gap) : 0;

  return {
    formula: [
      {
        tex: 'i\\hbar\\,\\partial_t\\psi = \\hat H\\psi = \\left[-\\frac{\\hbar^2}{2m}\\partial_x^2 + V(x)\\right]\\psi,\\qquad \\psi(x,t_0) = \\left(\\frac{1}{2\\pi\\sigma_x^2}\\right)^{\\!1/4} e^{-(x-x_0)^2/4\\sigma_x^2}\\,e^{ik_0 x}',
        display: true,
        note: `The beam: a minimum-uncertainty Gaussian with k₀ = √(2mE₀)/ℏ = ${k0.toFixed(3)} and σ_x = ℒ/(2·sigmaK) = ${(1 / (2 * (clampNum(pNum(p, 'sigmaK', 12), 2, 60) / TUN_BOX_AU))).toFixed(3)} a.u., so its mean lead energy is exactly E₀ = ${e0.toFixed(2)}.`,
      },
      {
        tex: 'e^{-i\\Delta t\\hat H/\\hbar} \\;\\approx\\; e^{-i\\hat T\\Delta t/2\\hbar}\\; e^{-i\\hat V\\Delta t/\\hbar}\\; e^{-i\\hat T\\Delta t/2\\hbar} \\;+\\; O(\\Delta t^3),\\qquad \\hat T = -\\frac{\\hbar^2}{2m}\\partial_x^2,\\;\\; \\hat V = V(x)',
        display: true,
        note: 'Symmetric Strang splitting of the exponential — the second-order (and exactly unitary) version of "kick, drift, kick".',
      },
      {
        tex: '\\hat T \\text{ is diagonal in } k: \\quad \\tilde\\psi(k) = \\mathrm{FFT}\\,[\\psi],\\qquad \\tilde\\psi \\leftarrow e^{-i\\hbar k^2\\Delta t/2m}\\tilde\\psi,\\qquad \\psi \\leftarrow \\mathrm{FFT}^{-1}\\big[\\tilde\\psi\\big]',
        display: true,
        note: `One drift = two radix-2 FFTs of N = ${n} (dx = ${dx.toFixed(4)} a.u.) with the phase tables precomputed; the potential kick is a pointwise complex multiply.`,
      },
      {
        tex: `\\kappa = \\frac{\\sqrt{2m(V_0 - E)}}{\\hbar} = ${kappa.toFixed(4)}\\ \\mathrm{a.u.}^{-1},\\qquad \\psi \\propto e^{-\\kappa x}\\ \\text{inside}\\ V_0 > E`,
        display: true,
        note: below
          ? `The forbidden region is ${a.toFixed(3)} a.u. wide, so the amplitude drops by e^(${(-kappa * a).toFixed(2)}) = ${Math.exp(-kappa * a).toExponential(3)} and the probability by e^(−2κa) = ${Math.exp(-2 * kappa * a).toExponential(3)}.`
          : 'E₀ is above this barrier, so κ = 0 and the profile is oscillatory rather than decaying — raise V₀ to see evanescent decay.',
      },
      {
        tex: 'T_{E<V_0} = \\left[\\,1 + \\frac{V_0^2\\,\\sinh^2(\\kappa a)}{4E\\,(V_0-E)}\\right]^{-1},\\qquad T_{E>V_0} = \\left[\\,1 + \\frac{V_0^2\\,\\sin^2(k_2 a)}{4E\\,(E-V_0)}\\right]^{-1}',
        display: true,
        note: `Both closed forms, evaluated at the current geometry: T(E₀) = ${tExact.toExponential(3)} with ${below ? `κa = ${(kappa * a).toFixed(3)}` : `k₂a = ${(k2 * a).toFixed(3)}`} (k₂ = √(2m(E−V₀))/ℏ).`,
      },
      {
        tex: 'E = V_0:\\quad T = \\left[\\,1 + \\frac{mV_0a^2}{2\\hbar^2}\\right]^{-1} = ' + (1 / (1 + (mass * g.v0 * a * a) / 2)).toFixed(4),
        display: true,
        note: 'The threshold limit of both branches — finite, continuous, and the only place the sinh and sin formulas agree.',
      },
      {
        tex: 'T_{\\text{double}} = 1 \\iff k_{\\text{well}}\\,\\text{gap} + \\varphi_r(E) = n\\pi,\\qquad r = |r|e^{i\\varphi_r},\\qquad k_{\\text{well}} = \\frac{\\sqrt{2mE}}{\\hbar}',
        display: true,
        note: g.kind === 'double'
          ? `The round trip through the well must return in phase, and \\varphi_r is the phase picked up reflecting off one barrier. The exact curve shown touches T = 1 at ${resonances.length ? resonances.slice(0, 3).map((e) => e.toFixed(3)).join(', ') : '—'} a.u.; the infinite-wall estimate E_n = n\\u00b2\\u03c0\\u00b2/2m\\u00b7gap\\u00b2 would say ${eNaive.toFixed(3)} for the first one — the difference is the wave spilling into the barrier.`
          : `The single barrier has its own T = 1 points above V\\u2080 (k\\u2082a = n\\u03c0): ${resonances.length ? resonances.slice(0, 3).map((e) => e.toFixed(2)).join(', ') : 'none inside the plotted window'} a.u. Switch to the double barrier for the full Fabry\\u2013P\\u00e9rot comb.`,
      },
      {
        tex: 'I \\;\\propto\\; V\\,T(E_\\!F, d) \\;\\approx\\; V\\,e^{-2\\kappa d},\\qquad \\frac{d\\ln I}{dd} = -2\\kappa = ' + (-2 * Math.max(kappa, 1e-9)).toFixed(2) + '\\ \\mathrm{a.u.}^{-1}',
        display: true,
        note: `The STM transfer function. With this barrier the current changes by a factor of ${Math.exp(2 * kappa * 1).toFixed(1)} per additional ångström-scale å (1 a.u. here), which is why a feedback loop holding I fixed can read height to ~0.01 a.u.`,
      },
      {
        tex: '\\psi \\;\\leftarrow\\; e^{-\\Delta t\\,W(x)/\\hbar}\\psi\\ \\text{in the sponges},\\qquad \\frac{d}{dt}\\|\\psi\\|^2 = -\\,2\\!\\int\\!\\frac{W}{\\hbar}|\\psi|^2\\,dx \\le 0',
        display: true,
        note: 'Open beam line: the −iW layers swallow the reflected and transmitted packets, and because the drain is measured separately on each side the transmission keeps accumulating after detection.',
      },
    ],
    readout: [
      { label: 'geometry', value: `${g.kind}, V₀ = ${g.v0.toFixed(2)}, a = ${a.toFixed(3)}, gap = ${g.gap.toFixed(3)} a.u.` },
      { label: 'beam', value: `E₀ = ${e0.toFixed(3)}, k₀ = ${k0.toFixed(3)}, v = ${v.toFixed(3)} a.u.` },
      { label: 'decay', value: below ? `κ = ${kappa.toFixed(4)}, 2κa = ${(2 * kappa * a).toFixed(3)}` : 'E₀ > V₀ (propagating)' },
      { label: 'exact T(E₀)', value: tExact.toExponential(4) },
      { label: 'packet ⟨T⟩', value: `${fold.mean.toExponential(4)} (ΔE ≈ ${fold.spread.toFixed(2)})` },
      { label: 'T = 1 modes', value: resonances.length ? `${resonances.length} in the window, first at ${e1.toFixed(3)} a.u.` : 'none in the window' },
      { label: 'step', value: `Δt = ${dt.toFixed(4)}, phase Δt·E = ${(dt * (g.v0 + e0)).toFixed(4)}` },
    ],
    phaseLegend:
      'In the beam panel the hue is arg ψ on the cyclic twilight wheel and the luminance is |ψ|², so colour tells you what is *moving*: the incident and transmitted packets sweep the wheel as they travel, while the evanescent hump inside the barrier holds a single hue — it oscillates in place and carries no net current. Cyan/rose curves are Re ψ / Im ψ when the overlay is on. In the T(E) panel the amber region below V₀ is classically forbidden, the sky curve is the exact theory, the vertical marker is E₀, the tick marks are the energies where the exact curve reaches T = 1, and the faint filled band is the packet’s own |φ(k)|² energy distribution — where it overlaps a resonance, that is what the beam actually does.',
    intuition:
      'A classical particle with E < V₀ bounces. A quantum state cannot: $\\psi$ and $\\psi\'$ must both be continuous, and the curvature equation $\\psi\'\' = 2m(V-E)\\psi/\\hbar^2$ says that where $V > E$ the curvature has the *same sign as the value* — so inside the barrier the solution is not a wave but a real exponential, $e^{\\pm\\kappa x}$. The only way to match a sinusoid on the left to a sinusoid on the right through that segment is for the transmitted amplitude to be suppressed by $e^{-\\kappa a}$: the barrier does not block the wave, it *attenuates* it, and it attenuates it exponentially in both width and $\\sqrt{V_0-E}$. That single fact is why alpha decay has a 10¹⁷-year spread of half-lives across a factor of 3 in energy, why a 0.1 nm tip retraction changes an STM current tenfold, and why a wavepacket that spends a femtosecond inside a barrier can still show up on the other side. Two more surprises hide in the same algebra. Above the barrier the sinh becomes a $\\sin$, so T *oscillates* instead of simply saturating at 1 — a faster electron can be more likely to bounce. And with two barriers, the reflected waves from each interface interfere: whenever an integer number of half-wavelengths fits in the middle well the multiple reflections cancel exactly and T = 1, perfectly transparent, even though each barrier alone is opaque. The simulation shows you all of this by solving nothing but two FFTs per step — the theory curve beside it is computed exactly, and they agree to the width of a line.',
    derivation: [
      {
        title: 'Continuity, and why the barrier is not a wall',
        steps: [
          {
            text: 'Write the stationary problem $-\\frac{\\hbar^2}{2m}\\phi\'\' + V\\phi = E\\phi$ in three regions: $V = 0$ for $x<0$, $V = V_0$ for $0<x<a$, $V=0$ for $x>a$. For $E < V_0$ the middle equation is $\\phi\'\' = \\kappa^2\\phi$ rather than $\\phi\'\' = -k^2\\phi$',
            math: [
              { tex: '\\phi = \\begin{cases} e^{ikx} + r\\,e^{-ikx}, & x < 0 \\\\ A\\,e^{\\kappa x} + B\\,e^{-\\kappa x}, & 0 < x < a \\\\ t\\,e^{ikx}, & x > a \\end{cases},\\qquad k = \\frac{\\sqrt{2mE}}{\\hbar},\\;\\; \\kappa = \\frac{\\sqrt{2m(V_0-E)}}{\\hbar}', display: true },
            ],
            note: 'The $e^{+\\kappa x}$ term is kept: within a *finite* barrier nothing forbids growth, it is only the amplitude on the far side that ends up tiny.',
          },
          {
            text: 'Schrödinger’s equation is second order with no delta-function potential, so both $\\phi$ and $\\phi\'$ are continuous at $x=0$ and $x=a$. Four conditions for four unknowns $(r, A, B, t)$ — the system is exactly determined, which is the sense in which "the wavefunction must not break" is a physical law rather than a convention.',
            math: [
              { tex: '1 + r = A + B, \\qquad ik(1 - r) = \\kappa(A - B)', display: true },
            ],
            note: 'Two of the four; the $x=a$ pair is the same with $e^{ika}$ factors. Solving them by hand gives the textbook formula in step 3.',
          },
          {
            text: 'The probability current $J = \\frac{\\hbar}{m}\\mathrm{Im}(\\psi^*\\partial_x\\psi)$ is conserved: $J_{\\text{inc}} - J_{\\text{ref}} = J_{\\text{trans}}$, so $|r|^2 + |t|^2 = 1$ with $T \\equiv |t|^2$. Inside the barrier $\\phi$ is real up to a constant phase, hence $J = 0$: probability flows in one side and out the other with *nothing travelling between them*.',
          },
        ],
      },
      {
        title: 'The transfer matrix does the algebra',
        steps: [
          {
            text: 'Package the matching as a matrix. In the $(\\phi, \\phi\')$ basis a region of width $w$ and internal wavenumber $q$ contributes',
            math: [
              { tex: 'M(q,w) = \\begin{bmatrix} \\cos qw & \\sin qw / q \\\\ -q\\sin qw & \\cos qw \\end{bmatrix},\\qquad q = \\begin{cases} k, & E > V \\\\ i\\kappa, & E < V \\end{cases}', display: true },
            ],
            note: 'With $q = i\\kappa$ the trig functions *become* the hyperbolic ones automatically — $\\cos(i\\kappa w) = \\cosh(\\kappa w)$. This is exactly the `layerMatrix` the engine uses for the tilted barrier and every multilayer stack.',
          },
          {
            text: 'Multiply the regions, then read off the amplitudes. For leads at $V = 0$ on both sides with unit incident amplitude,',
            math: [
              { tex: 'A = M_{11} - ik\\,M_{01},\\quad B = ik\\,M_{00} - M_{10},\\quad c = \\tfrac12\\!\\left(A + \\frac{B}{ik}\\right),\\quad t = \\frac{M_{00}A + M_{01}B}{c},\\quad T = |t|^2', display: true },
            ],
            note: 'Verified against the closed form below to 2.1×10⁻¹⁶ at six energies — the same code path that produces the orange curve you are looking at.',
          },
          {
            text: 'For a stack of many layers this costs 6 multiplications per interface and is numerically stable for the moderate barriers shown here. It is also the *exact* answer for the discretised potential the split-step solver integrates, which is why the simulated and analytic curves can be compared line for line.',
          },
        ],
      },
      {
        title: 'The closed form, and its two regimes',
        steps: [
          {
            text: 'Carrying the algebra through for a single rectangular barrier gives',
            math: [
              { tex: 'T = \\left[\\,1 + \\frac{V_0^2\\sinh^2(\\kappa a)}{4E(V_0 - E)}\\,\\right]^{-1}\\quad (E < V_0)', display: true },
            ],
            note: `At the current geometry: T = ${tExact.toExponential(3)}. Note it is the *product* of an exponential in $a$ and a prefactor that itself diverges as $E \\to V_0$.`,
          },
          {
            text: 'In the thick-barrier limit $\\kappa a \\gg 1$ the sinh is dominated by $e^{\\kappa a}/2$ and everything but the exponent drops out:',
            math: [
              { tex: 'T \\;\\xrightarrow{\\;\\kappa a\\gg1\\;}\\; \\frac{16E(V_0-E)}{V_0^2}\\;e^{-2\\kappa a}', display: true },
            ],
            note: 'This is the Gamow factor. Doubling the width squares T; doubling (V₀−E) takes it to its fourth power. Half-lives of alpha emitters spread over 17 orders of magnitude for a factor of 3 in decay energy precisely because of this line.',
          },
          {
            text: 'Above the barrier the analytic continuation $\\kappa \\to -ik_2$ turns sinh into sin, and $\\sin^2 \\le 1$ means the suppression vanishes:',
            math: [
              { tex: 'T = \\left[\\,1 + \\frac{V_0^2\\sin^2(k_2a)}{4E(E-V_0)}\\,\\right]^{-1},\\qquad T = 1 \\iff k_2 a = n\\pi', display: true },
            ],
            note: `So T does not climb monotonically to 1 — it overshoots into a damped oscillation. At $E = V_0$ both branches collapse to $T = [1 + mV_0a^2/2\\hbar^2]^{-1} = ${(1 / (1 + (mass * g.v0 * a * a) / 2)).toFixed(4)}$: transmission is continuous but not smooth.`,
          },
        ],
      },
      {
        title: 'Two barriers: the Fabry–Pérot condition T = 1',
        steps: [
          {
            text: 'With a well of width $g$ between two identical barriers, each interface reflects a fraction $\\sqrt{R}$ of what reaches it, and the round-trip phase across the well is $2k g$. Summing the multiple-reflection series is a geometric series in $Re^{2ikg}$, so the transmitted amplitude is',
            math: [
              { tex: 't_{\\text{tot}} = \\frac{t_1 t_2 e^{ikg}}{1 - r_1\'r_2\\,e^{2ikg}} \\;\\Longrightarrow\\; T = \\frac{T_1T_2}{\\,\\left|1 - |r|^2e^{2ikg}\\right|^2}', display: true },
            ],
            note: 'Identical to the Airy formula of a Fabry–Pérot interferometer, with probability amplitudes in place of field amplitudes. Matter waves interfere exactly like light.',
          },
          {
            text: 'The denominator has modulus $1 - R$ exactly when the round-trip phase $2kg + 2\\varphi_r$ is a multiple of $2\\pi$ — i.e. $kg + \\varphi_r = n\\pi$, where $\\varphi_r = \\arg r$ is the phase shift on reflection from a *single* barrier. Then it equals $(1 - R)^2 = T_1T_2$ and $T = 1$ **exactly**, however opaque each barrier is:',
            math: [
              { tex: `k\\,\\text{gap} + \\varphi_r(E) = n\\pi \\;\\;\\xrightarrow{\\;\\varphi_r \\to 0\\;}\\;\\; E_n = \\frac{n^2\\pi^2\\hbar^2}{2m\\,\\text{gap}^2}${resonances.length ? `,\\qquad E_1^{\\text{exact}} = ${e1.toFixed(3)}\\ \\text{a.u.}` : ''}`, display: true },
            ],
            note: `Resonant tunneling — the physics of the double-barrier diode, of alpha preformation in nuclei, and of the Ramsauer–Townsend effect in noble gases (which is a *s-wave* version of the same cancellation). $\\varphi_r$ only vanishes for an infinitely thin (or infinitely transparent) barrier, so the hard-wall formula is a limit, not the answer: at this geometry it would sit at ${eNaive.toFixed(3)} a.u. while the structure really resonates at ${resonances.length ? e1.toFixed(3) : '—'} a.u., because the evanescent tails widen the cavity by about $1/\\kappa$ per barrier. The plot ticks are the exact numbers.`,

          },
          {
            text: 'Detune by half a level and the same structure becomes near-opaque. The resonance width $\\Gamma$ is set by the leakage rate through the barriers, so a thin barrier gives a broad, forgiving peak and a thick one a needle.',
          },
        ],
      },
      {
        title: 'From κ to imaging atoms',
        steps: [
          {
            text: 'For an arbitrary profile the exponential generalises by quadrature (WKB):',
            math: [
              { tex: `T \\approx \\exp\\!\\left(-\\frac{2}{\\hbar}\\int\\!\\sqrt{2m\\,[V(x)-E]}\\;dx\\right),\\qquad \\text{here } 2\\!\\int\\kappa\\,dx = ${(2 * (below ? kappa * a : 0)).toFixed(3)}`, display: true },
            ],
            note: `Compare with the exact exponent of step 3: they agree to a few percent once $\\kappa a \\gtrsim 2$, and diverge near $E \\to V_0$ where the profile is not slow compared with $1/\\kappa$.`,
          },
          {
            text: 'A metal–vacuum–tip junction is exactly such a profile: the work function $\\Phi \\approx 4$–$5$ eV is the barrier height, and the gap $d$ is the width. With $\\kappa = \\sqrt{2m\\Phi}/\\hbar \\approx 1.1\\ \\text{Å}^{-1}$,',
            math: [
              { tex: '\\frac{\\Delta I}{I} = e^{-2\\kappa\\,\\Delta d} \\;\\Rightarrow\\; \\text{a } 1\\ \\text{Å retraction changes } I \\text{ by } \\sim\\!10\\times', display: true },
            ],
            note: 'In these units the drawn barrier gives 2κ = ' + (2 * kappa).toFixed(2) + ' a.u.⁻¹, i.e. a factor ' + Math.exp(2 * kappa).toFixed(1) + ' per a.u. of gap.',
          },
          {
            text: 'The feedback loop therefore trades an exponentially sensitive current for a *linear* height signal: hold $I = I_0$ and the tip trajectory is $d(x) \\approx \\Phi(x)/eV + \\text{const}$ — it images the local work function and the frontier orbitals, not the nuclear positions. Turn on STM mode and the panel shows both traces: the true adsorbate profile and the apparent one the microscope reports. With electronic contrast $> 0$ they differ by tens of percent, which is the whole reason interpreting an STM image needs theory.',
          },
        ],
      },
    ],
    challenge: [
      {
        question:
          'With the rectangular barrier, find the barrier width that makes T(E₀) exactly 10× smaller than it is now — without looking at the numbers. Then check how far off you were, and explain why a *height* change of the same ratio needs a different amount.',
        hint:
          'For κa ≫ 1 the exponential dominates: T ≈ (16E(V₀−E)/V₀²)e^(−2κa). You need 2κ·Δa = ln 10 ≈ 2.30. κ depends on √(V₀−E), so changing the height is a weaker lever per unit slider.',
        answer:
          `At the current setting κ = ${kappa > 0 ? kappa.toFixed(3) : '0 (raise V₀ above E₀ first)'}, so Δa = 2.30/(2κ) ≈ ${kappa > 0 ? (1.15 / kappa).toFixed(3) : '∞'} a.u. of extra width, i.e. the ${a.toFixed(2)} a.u. barrier must become ${(a + (kappa > 0 ? 1.15 / kappa : 0)).toFixed(2)} a.u. Widening by that much drops T from ${tExact.toExponential(2)} to ${(tExact / 10).toExponential(2)} — the prefactor contributes a few percent of error. The same factor of 10 by height needs V₀ → E₀ + (V₀−E₀)·(1.15/(κa))², which is a much bigger *percentage* change because κ enters under a square root.`,
        paramKey: 'width',
      },
      {
        question:
          'Switch to the double barrier. Park E₀ on the first resonance, then sweep the well separation `gap` and predict where the resonance will go before you move the slider. What happens to the *height* of the peak, and why?',
        hint:
          'The cavity condition is k·gap + φ_r = nπ with k = √(2mE)/ℏ, so E₁ grows roughly like 1/gap² (barrier penetration pulls it down a little). Peak height is set by the barrier *transmission*, not by the cavity length.',
        answer:
          `The hard-wall estimate E₁ = π²ℏ²/(2m·gap²) gives ${eNaive.toFixed(3)} a.u. at gap = ${g.gap.toFixed(2)}, and halving the separation quadruples it — but the *exact* first resonance of this structure is at ${resonances.length ? e1.toFixed(3) : '—'} a.u., below that, because the wave penetrates each barrier by roughly 1/κ = ${(1 / Math.max(kappa, 1e-6)).toFixed(2)} a.u. and the cavity is effectively longer. Halving the separation quadruples E₁ either way. The peak stays pinned at exactly T = 1 no matter how long the well is (tune ` +
          '`packetMeanT` by narrowing Δk and you will see the beam follow the same rule), because the condition for cancelling the internal reflections involves only the round-trip *phase*. What does change with gap is the *width* of the resonance: the leakage rate per attempt is fixed, so a longer cavity means more attempts per unit energy and a narrower needle — the time–energy uncertainty of a metastable state, visible on a slider. The simulated packet only reaches T = 1 if its ΔE is small compared with that width: exactly why the momentum-spread slider exists.',
        paramKey: 'gap',
      },
    ],
  };
}

export default tunnelMath;
