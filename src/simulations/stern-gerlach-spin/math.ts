/**
 * Stern–Gerlach Spin — synchronized live math drawer.
 *
 * Every string is generated from `buildModel(p)` + `chainAt(m, turns)`, i.e. the
 * same two calls the bench makes each frame, so the TeX always shows the spinor,
 * the projectors, the Malus angles and the channel weights that are currently being
 * simulated — including the answers to the two challenges, which are computed from
 * the live chain rather than looked up.
 *
 * The drawer renders `MathBlock.note` only for the headline formulas; derivation
 * steps are prose + TeX, so every live number inside a step is written into the
 * step text itself.
 */

import { angleBetween, blochVector, channelProbability, malus, v3, vDot } from '@/engine/physics/blochSpin';
import { pNum } from '@/store/useSimStore';
import type { MathBlock, SimChallenge, SimMathContent, SimParams } from '@/simulations/types';
import {
  FLIGHT_TIME_S,
  GAMMA_E_RAD_S_T,
  REFERENCE_MT,
  buildModel,
  chainAt,
  malusChain,
  openChainAt,
  portLabel,
} from './chain';

const pc = (v: number): string => `${(100 * v).toFixed(3)}%`;
const f4 = (v: number): string => v.toFixed(4);
const vec = (v: [number, number, number]): string =>
  `(${v[0].toFixed(3)},\\,${v[1].toFixed(3)},\\,${v[2].toFixed(3)})`;
const TAU = Math.PI * 2;

export function sternGerlachMath(p: SimParams): SimMathContent {
  const m = buildModel(p);
  const turns = pNum(p, 'phaseTurnsLive', 0);
  const chain = chainAt(m, turns);
  const open = openChainAt(m, turns);
  const mal = malusChain(m);
  const inUp = m.input.up;
  const inDown = m.input.down;
  const live = blochVector(m.input);
  const a1 = m.stages[0]?.axis ?? v3(0, 0, 1);
  const a2 = m.stages[1]?.axis ?? a1;
  const gamma12 = (angleBetween(a1, a2) * 180) / Math.PI;
  const half = (m.thetaDeg / 2).toFixed(2);
  const flipPlus = (() => {
    if (m.count < 3) return NaN;
    let sel = 0;
    let flip = 0;
    for (const c of chain.channels) {
      if (c.path[0] !== 1) continue;
      sel += c.probability;
      if (c.path[2] === -1) flip += c.probability;
    }
    return sel > 1e-12 ? flip / sel : NaN;
  })();
  const shots = Math.round(pNum(p, 'shotsLive', 0));
  const detected = Math.round(pNum(p, 'detectedLive', 0));
  const displayRate = TAU * m.precessionHz * (m.larmorMT / REFERENCE_MT);
  const s1 = open.stages[0] ?? { incident: 0, up: 0, down: 0, transmitted: 0 };
  const lastStage = chain.stages[m.count - 1] ?? { incident: 0, up: 0, down: 0, transmitted: 0 };
  const lastOpen = open.stages[m.count - 1] ?? { incident: 0, up: 0, down: 0, transmitted: 0 };
  const worst = chain.channels.length
    ? Math.min(...chain.channels.map((c) => c.probability))
    : 0;

  /* ------------------------------- formula -------------------------------- */

  const formula: MathBlock[] = [
    {
      tex: `|\\chi\\rangle=${inUp.re.toFixed(4)}|{\\uparrow}\\rangle+(${inDown.re.toFixed(4)}${inDown.im >= 0 ? '+' : '-'}${Math.abs(inDown.im).toFixed(4)}i)|{\\downarrow}\\rangle=\\cos(${half}^{\\circ})|{\\uparrow}\\rangle+e^{i${m.phiDeg.toFixed(1)}^{\\circ}}\\sin(${half}^{\\circ})|{\\downarrow}\\rangle`,
      display: true,
      note: `Bloch vector r = ⟨σ⃗⟩ = (${live[0].toFixed(4)}, ${live[1].toFixed(4)}, ${live[2].toFixed(4)}), |r| = ${Math.hypot(live[0], live[1], live[2]).toFixed(6)} — pure, so exactly 1.`,
    },
    {
      tex: `P_{\\pm}(\\hat{\\mathbf n})=\\tfrac12\\big(I\\pm\\boldsymbol\\sigma\\cdot\\hat{\\mathbf n}\\big),\\qquad P_{\\pm}^{2}=P_{\\pm},\\qquad P_{+}+P_{-}=I`,
      display: true,
      note: `Magnet 1 measures n̂₁ = ${vec(a1)}; its two ports carry ${pc(s1.up)} and ${pc(s1.down)} of what enters it, summing to ${(s1.up + s1.down).toFixed(6)}.`,
    },
    {
      tex: `P(\\pm_{\\mathbf m}\\!\\mid\\!\\pm_{\\mathbf n})=\\big|\\langle\\pm_{\\mathbf m}\\!\\mid\\!\\pm_{\\mathbf n}\\rangle\\big|^{2}=\\cos^{2}\\tfrac{\\gamma}{2}=\\tfrac12\\big(1\\pm\\hat{\\mathbf m}\\cdot\\hat{\\mathbf n}\\big),\\qquad\\gamma_{12}=${gamma12.toFixed(2)}^{\\circ}`,
      display: true,
      note: mal.length
        ? `Chain Malus factors: ${mal.map((x) => `${x.from}→${x.to} ${f4(x.t)} at ${x.angleDeg.toFixed(1)}°`).join(', ')}.`
        : 'One analyser in the chain, so there is no Malus step yet — add a second magnet.',
    },
    {
      tex: `\\mathcal A(p_1,\\dots,p_N)=\\langle p_N|\\,P_{p_N}\\cdots P_{p_2}P_{p_1}|\\chi\\rangle,\\qquad T=\\!\\!\\sum_{p\\;\\text{open}}\\!\\!|\\mathcal A|^{2}=${chain.transmitted.toFixed(6)}`,
      display: true,
      note: `Exit channels now: ${chain.channels.map((c) => `${portLabel(c.path)} ${f4(c.probability)}`).join(' · ')} — Σ = ${chain.channels.reduce((s, c) => s + c.probability, 0).toFixed(6)}, absorbed ${chain.blocked.toFixed(6)}.`,
    },
  ];

  /* ------------------------------- readout -------------------------------- */

  const readout: { label: string; value: string }[] = [
    { label: 'θ', value: `${m.thetaDeg.toFixed(2)}°` },
    { label: 'φ', value: `${m.phiDeg.toFixed(2)}°` },
    { label: '⟨σz⟩', value: live[2].toFixed(6) },
    { label: '⟨σx⟩', value: live[0].toFixed(6) },
    { label: '⟨σy⟩', value: live[1].toFixed(6) },
    { label: 'P₁(±)', value: `${f4(s1.up)} / ${f4(s1.down)}` },
    { label: 'γ₁₂', value: `${gamma12.toFixed(2)}°` },
    { label: 'cos²(γ₁₂/2)', value: malus(a1, a2).toFixed(6) },
    { label: 'transmitted T', value: chain.transmitted.toFixed(6) },
    { label: 'absorbed', value: chain.blocked.toFixed(6) },
    { label: 'channels', value: String(chain.channels.length) },
    { label: 'counts', value: `${detected}/${shots}` },
    { label: 'ω_L', value: `${(m.omegaLarmor / 1e9).toFixed(4)} grad/s` },
    { label: 'γ_e B t', value: `${m.trueAngleRad.toFixed(1)} rad` },
    { label: 'slow motion', value: Number.isFinite(m.slowMotion) ? `×${m.slowMotion.toExponential(2)}` : 'n/a (B = 0)' },
    { label: 'flight', value: `${(FLIGHT_TIME_S * 1e6).toFixed(0)} µs` },
  ];

  const phaseLegend =
    'On the sphere the blue arrow is the spinor inside the beam right now: its polar angle fixes P(±z) and its azimuth is the phase e(iφ). The pale arrow is the prepared |χ⟩ before any Larmor rotation, the coloured double arrows are the ± measurement directions of the live magnets, and the bright latitude circle is the precession orbit about the guide field ẑ. On the bench a teal ray is a σ·n̂ = +1 port, a rose ray is −1, and an amber cross is an absorbed beam — ray thickness is |P±χ|², never an artistic choice.';

  const intuition = `A Stern–Gerlach magnet is a measurement device, not a reading device: it does not uncover a number already written on the atom, it sorts the ensemble into the two eigenstates of the operator it happens to measure, $\\hat{\\mathbf n}\\cdot\\boldsymbol\\sigma$. Because that operator has only two eigenvalues, everything the magnets can see about an atom is a point on a sphere — the spinor $|\\chi\\rangle=\\cos\\tfrac\\theta2|\\uparrow\\rangle+e^{i\\varphi}\\sin\\tfrac\\theta2|\\downarrow\\rangle$ — and each analyser simply projects onto one of its own two axes.

That one fact produces every surprise in this lab. Two magnets in the same direction are perfectly repeatable: ${pc(malus(a1, a1))} of the atoms selected by magnet 1 come out of a parallel magnet's same port again, so the second one changes nothing. Tilt it by $\\gamma$ and the split becomes $\\cos^2\\tfrac\\gamma2$ — the spin-1/2 version of Malus law, with the half angle, because a spinor needs $4\\pi$ rather than $2\\pi$ to return to itself.

Put a third magnet back along the first axis and the memory of the first measurement is gone: the intermediate analyser replaced the $|{\\uparrow}\\rangle_1$ beam with beams aligned to $\\hat{\\mathbf n}_2$, so a $\\hat{\\mathbf n}_3\\parallel\\hat{\\mathbf n}_1$ analyser has to randomise them again. That conditional flip probability reads ${Number.isFinite(flipPlus) ? pc(flipPlus) : 'n/a (fewer than three analysers)'} right now, where a classical hidden label would demand exactly 0%. Nothing here is averaged over hidden variables — the histogram in the Statistics tab is the theory meeting its own shot noise.`;

  /* ------------------------------ derivation ------------------------------ */

  const derivation = [
    {
      title: 'From μ·B to a two-level analyser',
      steps: [
        {
          text: `A silver atom in its ground state has zero orbital and nuclear moment; the magnetic moment is carried entirely by the unpaired 5s electron, $\\hat{\\boldsymbol\\mu}=-g_e\\mu_B\\hat{\\mathbf S}/\\hbar$ with $g_e\\approx2.0023$. In an inhomogeneous field the interaction Hamiltonian is`,
          math: [
            {
              tex: '\\hat H=-\\hat{\\boldsymbol\\mu}\\cdot\\hat{\\mathbf B}(\\mathbf r)=\\frac{g_e\\mu_B}{\\hbar}\\,\\hat{\\mathbf S}\\cdot\\hat{\\mathbf B}(\\mathbf r)',
              display: true,
            },
          ],
        },
        {
          text: 'The Ehrenfest force on the centre of mass is $M\\ddot{\\mathbf r}=-\\langle\\nabla\\hat H\\rangle$, so only the gradient of the field separates beams — a uniform field would merely torque the spin. With $\\mathbf B\\approx B_z(x,y,z)\\hat{\\mathbf z}$ this is $F_z=\\mu_z\\,\\partial B_z/\\partial z$, and the classic magnet is saw-toothed exactly to make that gradient large while pointing $\\mathbf B$ along $\\hat{\\mathbf z}$ in the beam region.',
          math: [
            { tex: 'F_z=\\mu_z\\frac{\\partial B_z}{\\partial z},\\qquad \\mu_z=\\mp\\tfrac12 g_e\\mu_B', display: true },
          ],
        },
        {
          text: `Because $\\hat{\\mathbf S}=\\tfrac{\\hbar}{2}\\boldsymbol\\sigma$, the operator that matters is $\\boldsymbol\\sigma\\cdot\\hat{\\mathbf n}$, whose spectrum is $\\{+1,-1\\}$ for every unit vector $\\hat{\\mathbf n}$. Diagonalising it yields exactly two eigenstates, which is why one magnet can never produce three beams — that dichotomy was the discovery. For the present magnet 1, n̂₁ = ${vec(a1)} is its own "up" at θ = ${((Math.acos(Math.max(-1, Math.min(1, a1[2]))) * 180) / Math.PI).toFixed(1)}°, φ = ${(((Math.atan2(a1[1], a1[0]) * 180) / Math.PI + 360) % 360).toFixed(1)}°.`,
          math: [
            {
              tex: '\\big(\\boldsymbol\\sigma\\cdot\\hat{\\mathbf n}\\big)|\\pm_{\\mathbf n}\\rangle=\\pm|\\pm_{\\mathbf n}\\rangle,\\qquad |+_{\\mathbf n}\\rangle=\\begin{pmatrix}\\cos\\tfrac\\vartheta2\\\\[2pt] e^{i\\varphi}\\sin\\tfrac\\vartheta2\\end{pmatrix}',
              display: true,
            },
          ],
        },
        {
          text: `Projectors do the bookkeeping the engine actually runs: a port's weight is the squared norm of the projected spinor, and the emerging beam is that projection renormalised — the collapse. Right now magnet 1 gives w₊ = ${s1.up.toFixed(6)}, w₋ = ${s1.down.toFixed(6)} and w₊ + w₋ = ${(s1.up + s1.down).toFixed(6)} exactly, so no probability is created or lost by the split itself.`,
          math: [
            {
              tex: 'P_{\\pm}=\\tfrac12\\big(I\\pm\\boldsymbol\\sigma\\cdot\\hat{\\mathbf n}\\big),\\quad w_{\\pm}=\\lVert P_{\\pm}|\\chi\\rangle\\rVert^{2},\\quad |\\chi_{\\text{after}}\\rangle=\\frac{P_{\\pm}|\\chi\\rangle}{\\lVert P_{\\pm}|\\chi\\rangle\\rVert}',
              display: true,
            },
          ],
        },
        {
          text: `For a general spinor the two weights collapse to one line: the Bloch vector dotted with the analyser axis. Here r·n̂₁ = ${vDot(live, a1).toFixed(6)} and the engine's independent channelProbability gives ${(channelProbability(m.input, a1, 1)).toFixed(6)} for the + port, agreeing to round-off.`,
          math: [
            {
              tex: 'w_{\\pm}=\\tfrac12\\big(1\\pm\\mathbf r\\cdot\\hat{\\mathbf n}\\big),\\qquad \\mathbf r=\\langle\\boldsymbol\\sigma\\rangle=(2\\,\\mathrm{Re}\\,a^{*}b,\\;2\\,\\mathrm{Im}\\,a^{*}b,\\;|a|^{2}-|b|^{2})',
              display: true,
            },
          ],
        },
      ],
    },
    {
      title: 'Sequential projections, Malus law and the eraser',
      steps: [
        {
          text: `Feed one eigenstate of analyser 1 into analyser 2: the state entering the second magnet is $|+_{\\mathbf n_1}\\rangle$, so the amplitude for port $p$ of the second is the overlap $\\langle p_{\\mathbf n_2}|+_{\\mathbf n_1}\\rangle$, and the geometry of two spin-1/2 axes gives the half-angle law. For the current pair, n̂₁·n̂₂ = ${vDot(a1, a2).toFixed(6)}, i.e. γ₁₂ = ${gamma12.toFixed(2)}°, so cos²(γ/2) = ${malus(a1, a2).toFixed(6)} and sin²(γ/2) = ${(1 - malus(a1, a2)).toFixed(6)}.`,
          math: [
            {
              tex: `\\big|\\langle\\pm_{\\mathbf m}|+_{\\mathbf n}\\rangle\\big|^{2}=\\cos^{2}\\tfrac\\gamma2=\\tfrac12\\big(1\\pm\\hat{\\mathbf m}\\cdot\\hat{\\mathbf n}\\big)`,
              display: true,
            },
          ],
        },
        {
          text: `The projection postulate is what makes chains non-commutative: after a measurement the state is the eigenstate, and the information that it had been anything else is destroyed. Multiply amplitudes along a path and sum $|\\mathcal A|^2$ over the open exit channels — for this apparatus $T=${chain.transmitted.toFixed(6)} out of an incoming 1, with ${chain.blocked.toFixed(6)} absorbed by the beam blocks.`,
          math: [
            {
              tex: `\\mathcal A(p_1,\\dots,p_N)=\\langle p_N|P_{p_N}\\cdots P_{p_2}P_{p_1}|\\chi\\rangle,\\qquad T=\\sum_{p\\;\\text{open}}|\\mathcal A|^{2}`,
              display: true,
            },
          ],
        },
        {
          text: 'Two magnets parallel: the second can do nothing, because the beam entering it is already an eigenstate of what it measures, so a flip is impossible. Set the chain to SG1 = SG3 with the middle removed and the same conditional probability drops to exactly 0 — the drawer recomputes live, so the claim is checkable by hand.',
          math: [
            {
              tex: `\\hat{\\mathbf n}_1\\parallel\\hat{\\mathbf n}_2:\\quad P(-_{\\mathbf n_1}\\!\\mid\\!+_{\\mathbf n_1})=0,\\qquad \\text{this chain: }P(SG3=-\\!\\mid\\!SG1=+)=${Number.isFinite(flipPlus) ? flipPlus.toFixed(6) : '\\text{n/a}'}`,
              display: true,
            },
          ],
        },
        {
          text: 'Insert a magnet between them at 90° and the last analyser re-randomises: cos²45° = ½ into each of its ports, whatever the first analyser selected. That is the quantum eraser in its purest mechanical form — no which-path detector, no interference term, only a projection that traded one basis for another. Plug one port of the middle magnet and determinism returns, because the surviving atoms then never occupied two paths.',
          math: [
            {
              tex: '\\hat{\\mathbf n}_1\\perp\\hat{\\mathbf n}_2:\\quad P(+_{\\mathbf n_2}\\!\\mid\\!+_{\\mathbf n_1})=\\tfrac12,\\qquad P(+_{\\mathbf n_1}\\!\\mid\\!+_{\\mathbf n_2})=\\tfrac12',
              display: true,
            },
          ],
        },
        {
          text: `Real atoms arrive one at a time, so the theory is a distribution over up to $2^N$ exit channels; the engine samples it with a seeded generator, and shot noise falls as $1/\\sqrt N$. The present run has ${detected} detections from ${shots} fired against a predicted ${(chain.transmitted * shots).toFixed(1)}, so the expected statistical spread is $\\sqrt{Np(1-p)}\\approx${shots > 0 ? Math.sqrt(shots * chain.transmitted * (1 - chain.transmitted)).toFixed(1) : '\\text{fire the beam}'} counts.`,
          math: [
            {
              tex: '\\mathbb E[n_k]=Np_k,\\qquad \\sigma_{n_k}=\\sqrt{Np_k(1-p_k)}',
              display: true,
            },
          ],
        },
      ],
    },
    {
      title: 'Larmor precession in the drift space',
      steps: [
        {
          text: `A uniform guide field along ẑ exerts no net force but torques the moment: $i\\hbar\\,\\partial_t|\\chi\\rangle=-\\tfrac{\\hbar\\omega_L}{2}\\sigma_z|\\chi\\rangle$ with $\\omega_L=g_e\\mu_BB/\\hbar$. The evolution operator is exactly the SU(2) rotation the engine uses, and at B = ${m.larmorMT.toFixed(2)} mT it gives ω_L = ${m.omegaLarmor.toExponential(3)} s⁻¹.`,
          math: [
            {
              tex: `U(t)=e^{-i\\omega_L t\\,\\sigma_z/2},\\qquad \\gamma_e=\\frac{g_e\\mu_B}{\\hbar}=${GAMMA_E_RAD_S_T.toExponential(6)}\\ \\mathrm{rad\\,s^{-1}\\,T^{-1}}`,
              display: true,
            },
          ],
        },
        {
          text: m.larmorMT > 0
            ? `Over the time of flight the spinor turns by φ = ω_L t = ${m.trueAngleRad.toFixed(3)} rad = ${(m.trueAngleRad / TAU).toFixed(1)} turns for a ${(FLIGHT_TIME_S * 1e6).toFixed(0)} µs flight — enormous, which is why the animation runs at ${displayRate.toFixed(3)} rad/s, a documented slow motion of ×${m.slowMotion.toExponential(2)} against the ${REFERENCE_MT} mT reference.`
            : `With B = 0 there is nothing to precess about: ω_L = γ_e·B = 0, so φ = ω_L t = 0 over the ${(FLIGHT_TIME_S * 1e6).toFixed(0)} µs flight and the spinor reaching analyser 2 is exactly the one analyser 1 produced. Raise the guide field and the phase between the two amplitudes starts to rotate; for a state on the x̂–ŷ equator that rotation is invisible in P(±z) but immediate in P(±x̂) or P(±ŷ).`,
          math: [
            { tex: '\\phi=\\omega_L t=\\gamma_e B t', display: true },
          ],
        },
        {
          text: `Precession about ẑ only moves the azimuth, so P(±z) is invariant while transverse analysers read the phase directly: currently P(+z) = ${pc(channelProbability(m.input, v3(0, 0, 1), 1))} and P(+x) = ${pc(channelProbability(m.input, v3(1, 0, 0), 1))}, and only the second one sweeps as φ advances. That is the classic way to convert a phase into a population.`,
          math: [
            {
              tex: '|\\chi(t)\\rangle=\\cos\\tfrac\\theta2|\\uparrow\\rangle+e^{i(\\varphi-\\omega_L t)}\\sin\\tfrac\\theta2|\\downarrow\\rangle',
              display: true,
            },
          ],
        },
      ],
    },
  ];

  /* ------------------------------ challenges ------------------------------ */

  const recipe = buildModel({
    ...p,
    stages: 3,
    a1Axis: 'z',
    a2Axis: 'x',
    a3Axis: 'y',
    spinTheta: 90,
    spinPhi: 0,
    block1Down: true,
    block2Down: true,
    block3Down: true,
    larmor: 0,
  });
  const recipeChain = chainAt(recipe, 0);
  const second = m.stages[1] ?? m.stages[0];
  const secondLabel = second
    ? second.kind === 'custom'
      ? `az ${second.azDeg.toFixed(0)}° el ${second.elDeg.toFixed(0)}°`
      : `${second.kind}̂`
    : 'x̂';

  const challenge: SimChallenge[] = [
    {
      question:
        'Configure the apparatus so that exactly 12.5% of the atoms entering the first magnet reach the detector — no more, no less.',
      hint: 'Each single-port analyser multiplies the surviving beam by cos²(γ/2). You need 1/8 as a product of three factors of 1/2, so prepare a state at 90° to the first magnet, run three mutually orthogonal axes and open only one port of each.',
      answer: `Prepare |+x⟩ (θ = 90°, φ = 0°), then set SG1 = ẑ, SG2 = x̂, SG3 = ŷ and plug the "−" beam of all three. The projections are ⟨+z|+x⟩, ⟨+x|+z⟩, ⟨+y|+x⟩, each of modulus $1/\\sqrt2$, so $T=(1/2)^3=1/8=12.500\\%$; this engine returns ${recipeChain.transmitted.toFixed(12)}, an absolute error of ${Math.abs(recipeChain.transmitted - 0.125).toExponential(2)} from round-off alone. Another valid family: start from |↑z⟩ and take two 90° steps (½ · ½) followed by a 120° step (¼) — the challenge is that 120° needs a custom axis. Your chain transmits ${pc(chain.transmitted)} at the moment.`,
      paramKey: 'a3Axis',
    },
    {
      question:
        'Make the third analyser a deterministic filter: choose its axis and plug one port so that it never loses an atom, while the first two magnets still do something interesting.',
      hint: 'An analyser is lossless for a beam that is already an eigenstate of the component it measures. The atoms arriving at SG3 are eigenstates of σ·n̂₂, so ask SG3 exactly the question SG2 asked.',
      answer: `Give SG3 the same axis as SG2 (currently ${secondLabel}) and plug the port SG2 does not use. Then $\\hat{\\mathbf n}_3\\parallel\\hat{\\mathbf n}_2$ gives $\\cos^2 0 = 1$ into the open port and $\\sin^2 0 = 0$ into the plugged one, so nothing is absorbed. Live check: SG3 receives ${f4(lastOpen.incident)} and lets out ${f4(lastStage.transmitted)}, and the smaller exit channel carries ${pc(worst)} of the beam — driving that minimum to exactly 0% is what solving it looks like.`,
      paramKey: 'a3Axis',
    },
  ];

  return { formula, readout, phaseLegend, intuition, derivation, challenge };
}
