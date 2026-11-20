/**
 * de Broglie Ring — synchronized math drawer content.
 *
 * Everything here is recomputed from the live state: the headline equations
 * carry the current λ, n and r, and the two challenges quote the numbers the
 * learner actually has to hit with the sliders.
 */

import { BOHR_RADIUS_M } from '@/engine/physics/constants';
import type { SimMathContent, SimParams } from '@/simulations/types';
import { pStr } from '@/store/useSimStore';
import { PLANCK_J_S, deBroglieSI, diffractionVerdict, formatLength, ringState } from './physics';

const A0_NM = BOHR_RADIUS_M * 1e9;

export function deBroglieMath(p: SimParams): SimMathContent {
  const r = ringState(p);
  const d = deBroglieSI(p);
  const nInt = Math.max(1, Math.round(r.n));
  const bohrRadius = (nInt * nInt) * A0_NM; // hydrogen, Z = 1
  const lamNm = r.wavelengthNm;
  const scaleMode = pStr(p, 'tab', 'orbit') === 'scale';
  const verdict = diffractionVerdict(d);

  return {
    formula: [
      {
        tex: `\\lambda = \\frac{h}{p} = \\frac{h}{\\gamma m v} = ${lamNm.toFixed(3)}\\ \\mathrm{nm} = ${r.lamAU.toFixed(2)}\\ a_0`,
        display: true,
        note: 'The wavelength actually wrapped on the ring right now.',
      },
      {
        tex: `\\oint p\\,\\mathrm{d}q = n h \\;\\Longrightarrow\\; 2\\pi r = n\\lambda \\;\\Longrightarrow\\; n = \\frac{2\\pi r}{\\lambda} = ${r.n.toFixed(3)}`,
        display: true,
        note: 'Bohr–Sommerfeld quantisation is nothing but single-valuedness of the matter wave.',
      },
      {
        tex: `\\psi(\\theta, t) = e^{-i\\omega t}\\left[e^{in\\theta} + Q\\,e^{-in\\theta}\\right],\\qquad Q = \\frac{1}{K}\\left|\\sum_{k=0}^{K-1} e^{\\,i2\\pi n k}\\right| = ${r.quality.toFixed(3)}`,
        display: true,
        note: 'Q is the round-trip buildup: 1 on resonance (pure standing wave), 0 when the wrap-around phase cancels (pure travelling wave).',
      },
    ],
    readout: [
      { label: 'winding n', value: r.n.toFixed(3) },
      { label: 'nearest allowed', value: `n = ${nInt}` },
      { label: 'residual 2πr/λ − n', value: `${r.residual >= 0 ? '+' : ''}${r.residual.toFixed(4)}` },
      { label: 'buildup Q', value: r.quality.toFixed(3) },
      { label: 'circumference', value: `${r.circAU.toFixed(2)} a₀ = ${(r.circAU * A0_NM).toFixed(3)} nm` },
      { label: `Bohr r_${nInt}`, value: `${nInt * nInt} a₀ = ${bohrRadius.toFixed(3)} nm` },
      { label: 'λ (beam)', value: formatLength(d.lambdaM) },
      { label: 'λ / aperture', value: d.ratio.toExponential(2) },
    ],
    phaseLegend: scaleMode
      ? 'In the Scale Explorer the horizontal axis is logarithmic in metres: the glowing marker is the de Broglie wavelength, the hollow bar is the aperture, and the reference ticks are a lattice spacing (0.21 nm), a proton (0.84 fm) and the Planck length. A fringe needs the wavelength bar to reach the aperture bar.'
      : 'Hue is the phase of the matter wave: the wheel runs through the twilight palette as $\\arg\\psi$ goes from $-\\pi$ to $+\\pi$, so a hue that *rotates* around the ring means a travelling wave while a hue that is frozen in place means a standing wave. Radial offset is $\\mathrm{Re}\\,\\psi$ and brightness is $|\\psi|$ — dim arcs are genuine nodes of the probability, not shading.',
    intuition: scaleMode
      ? `Matter waves are real for every object — but "real" only where an aperture can match them. This beam has $\\lambda = ${formatLength(d.lambdaM)}$ and momentum $p = ${d.pSI.toExponential(2)}\\ \\mathrm{kg\\,m\\,s^{-1}}$, so a slit of ${formatLength(d.apertureM)} diffracts it by $\\sin\\theta_1 = \\lambda/a$. ${verdict.headline} ${verdict.detail}`
      : `de Broglie's idea was to give the electron in a Bohr orbit an actual wave to ride on. Wrap a wave of wavelength $\\lambda$ around a circle of circumference $2\\pi r$: after one lap it is out of step with itself by the phase $2\\pi n$ with $n = 2\\pi r/\\lambda$. Only when $n$ is a whole number does the wave close on itself, and then the outbound and returning crests reinforce turn after turn until a stationary pattern with pinned nodes appears — exactly the $n$-lobed orbit Bohr postulated. Every other radius is self-cancelling: the ${r.circuits} accumulated round-trip phasors stay bounded by $1/|\\sin\\pi n|$ while the number of laps grows, so the surviving amplitude per lap collapses towards zero. That is why the atom has discrete shells — not because the electron is forbidden from other orbits, but because the other orbits destructively interfere with themselves.`,
    derivation: [
      {
        title: 'From λ = h/p to the Bohr radii',
        steps: [
          {
            text: 'Attach a plane wave to a free particle of momentum p. The phase factor fixes both the wavelength and the wave number.',
            math: [
              {
                tex: '\\psi \\propto e^{\\,i(\\mathbf{k}\\cdot\\mathbf{r} - \\omega t)},\\qquad k = \\frac{p}{\\hbar},\\qquad \\lambda = \\frac{2\\pi}{k} = \\frac{h}{p}',
                display: true,
              },
            ],
          },
          {
            text: 'Constrain the wave to a circle of radius r. Only the angular coordinate survives, and the winding number is the phase gained per radian.',
            math: [
              {
                tex: '\\psi(\\theta) = e^{\\,in\\theta},\\qquad n \\equiv kr = \\frac{2\\pi r}{\\lambda}',
                display: true,
              },
            ],
          },
          {
            text: 'A wavefunction must be single-valued: going once around the ring has to return the same complex number. That restricts n to the integers and turns n into the quantum number.',
            math: [
              {
                tex: '\\psi(\\theta + 2\\pi) = \\psi(\\theta) \\;\\Rightarrow\\; e^{\\,i2\\pi n} = 1 \\;\\Rightarrow\\; n \\in \\mathbb{Z} \\;\\Rightarrow\\; 2\\pi r = n\\lambda',
                display: true,
                note: 'Equivalently ∮p·dq = p·2πr = nh — the old Bohr quantisation rule, now a boundary condition.',
              },
            ],
          },
          {
            text: 'Combine with the Coulomb force balance to get the allowed radii and energies of a hydrogen-like ion.',
            math: [
              {
                tex: '\\frac{m v^2}{r} = \\frac{Z e^2}{4\\pi\\varepsilon_0 r^2},\\quad mvr = n\\hbar \\;\\Rightarrow\\; r_n = \\frac{n^2 a_0}{Z},\\quad a_0 = 0.529\\ \\text{\\AA}',
                display: true,
              },
              { tex: `E_n = -\\frac{Z^2 \\cdot 13.6\\ \\text{eV}}{n^2},\\qquad v_n = \\frac{Zc\\alpha}{n}`, display: true },
              {
                tex: `\\Rightarrow\\; r_${nInt} = ${nInt * nInt}\\ a_0 = ${bohrRadius.toFixed(4)}\\ \\text{nm},\\qquad \\lambda_${nInt} = \\frac{2\\pi r_${nInt}}{${nInt}} = ${(r.nInt > 0 ? ((2 * Math.PI * nInt * nInt) / nInt) * A0_NM : 0).toFixed(4)}\\ \\text{nm}`,
                display: true,
                note: 'The orbit shown on screen is resonant at this n; the ring only has to satisfy 2πr = nλ, so any (r, λ) pair on that line works.',
              },
            ],
          },
        ],
      },
      {
        title: 'Why non-integer windings cancel',
        steps: [
          {
            text: 'Let the wave circulate and add up its field after each lap. Circuit k contributes the phase e^{i2πnk}, so the accumulated amplitude is a geometric phasor sum.',
            math: [{ tex: 'S_K = \\sum_{k=0}^{K-1} e^{\\,i2\\pi n k} = \\frac{1 - e^{\\,i2\\pi n K}}{1 - e^{\\,i2\\pi n}}', display: true }],
          },
          {
            text: 'Take the modulus and normalise per lap — this is the resonance curve drawn in the inset.',
            math: [
              {
                tex: 'Q(n) = \\frac{|S_K|}{K} = \\left|\\frac{\\sin(\\pi n K)}{K\\,\\sin(\\pi n)}\\right| \\;\\xrightarrow[n \\to n_int]{}\\; 1, \\qquad Q \\le \\frac{1}{K\\,|\\sin \\pi n|}\\ \\text{otherwise}',
                display: true,
              },
            ],
          },
          {
            text: 'Away from an integer the numerator stays bounded by 1 while the denominator holds |sin πn|: more laps never help, the pieces point in different directions and the mean amplitude per lap falls as 1/K. Exactly half-integer winding gives Q = 0 — the wrap-around wave cancels the outbound one point for point.',
            math: [
              {
                tex: `n = ${r.nRaw.toFixed(3)} \\;\\Rightarrow\\; 2\\pi\\,\\mathrm{frac}(n) = ${r.seamAngle.toFixed(3)}\\ \\mathrm{rad},\\quad |e^{\\,i2\\pi n} - 1| = ${r.seamMagnitude.toFixed(3)},\\quad Q = ${r.qualityRaw.toFixed(3)}`,
                display: true,
                note: 'The seam arrow on the ring is that mismatch vector, drawn where θ wraps from 2π back to 0.',
              },
            ],
          },
          {
            text: 'Letting K → ∞ turns the sum into a comb of delta functions: only integer windings have a non-zero projection onto a single-valued state, which is the same statement as ⟨n|ψ⟩ vanishing for a non-closing wave.',
            math: [{ tex: '\\lim_{K\\to\\infty}\\frac{1}{K}\\sum_{k<K} e^{\\,i2\\pi nk} = \\begin{cases} 1 & n \\in \\mathbb{Z} \\\\ 0 & n \\notin \\mathbb{Z}\\end{cases}', display: true }],
          },
        ],
      },
      {
        title: 'Real beams: λ against the aperture',
        steps: [
          {
            text: 'Use the relativistic momentum so accelerator voltages come out right.',
            math: [
              {
                tex: `p = \\gamma m v,\\quad \\gamma = (1-\\beta^2)^{-1/2},\\quad \\lambda = \\frac{h}{p} = ${d.lambdaM.toExponential(3)}\\ \\mathrm{m}`,
                display: true,
              },
              {
                tex: `K = (\\gamma - 1)mc^2 = ${(d.kineticEv / 1e3).toFixed(2)}\\ \\mathrm{keV},\\quad \\beta = ${d.beta.toFixed(4)}`,
                display: true,
                note: 'For the 100 keV electron preset this gives λ = 3.701 pm; the non-relativistic λ = h/√(2mK) would give 3.878 pm — 4.8 % high — and using p = mv at the same speed would give 4.426 pm.',
              },
            ],
          },
          {
            text: 'Diffraction only shows up when the wavelength is a sizeable fraction of the opening.',
            math: [
              {
                tex: `\\theta_1 \\approx \\frac{\\lambda}{a} = \\frac{${d.lambdaM.toExponential(2)}}{${d.apertureM.toExponential(2)}} = ${d.ratio.toExponential(2)}\\ \\mathrm{rad}`,
                display: true,
              },
            ],
          },
          {
            text: 'Compare with the grating a beam actually meets: 0.21 nm graphite layers for neutrons, atomic columns for electrons, and nothing at all for a cricket ball.',
            math: [
              {
                tex: `\\lambda_{\\text{ball}} = \\frac{h}{mv} = \\frac{${PLANCK_J_S.toExponential(3)}}{0.16 \\times 30} = 1.38\\times 10^{-34}\\ \\mathrm{m}`,
                display: true,
                note: 'That is ~19 orders of magnitude below a proton radius, so no aperture exists; and any scattered photon localises the ball far better than a slit could.',
              },
            ],
          },
        ],
      },
    ],
    challenge: [
      {
        question: `Freeze λ by turning off "Lock λ to 2πr/n", then drag the radius until the ring locks onto n = 3. With the wavelength currently at λ = ${r.lamAU.toFixed(2)} a₀, which radius should that be?`,
        hint: 'Resonance needs 2πr = nλ, so r = 3λ/2π = 3λ/6.2832. Watch the buildup Q jump to 1 as you cross it.',
        answer: `r = 3λ/2π = ${(3 * r.lamAU / (2 * Math.PI)).toFixed(2)} a₀ (${((3 * r.lamAU * A0_NM) / (2 * Math.PI)).toFixed(3)} nm). In a hydrogen atom this is the 3s/3p shell at 9 a₀ = 0.476 nm — reached when λ = 2π·9/3 = 18.85 a₀.`,
        paramKey: 'radiusAU',
      },
      {
        question:
          'In the Scale Explorer, set the aperture to the graphite layer spacing (0.21 nm) and find which beam is Bragg-matched, i.e. has λ/a between 0.75 and 1.0. Why does that beam diffract from a crystal while a 100 keV electron needs a specimen of atomic columns?',
        hint: 'Go to 2.2×10³ m/s with a mass of 1.67×10⁻²⁷ kg (the "Thermal n" preset) and read off λ/a. Then try the 100 keV electron.',
        answer:
          'Thermal neutrons: λ = h/(mv) = 1.798×10⁻¹⁰ m = 0.180 nm, so λ/a = 0.86 — Bragg-matched, which is exactly why neutron diffraction works. A 100 keV electron has λ = 3.70 pm, 49× smaller, so it only diffracts off the atomic lattice itself (and penetrates far deeper), which is what makes the electron microscope a phase-contrast instrument rather than a surface one.',
        paramKey: 'massChoice',
      },
    ],
  };
}
