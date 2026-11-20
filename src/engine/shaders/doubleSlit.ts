/**
 * GLSL ES 3.00 programs for the 2D Double-Slit interferometer (Sim 5).
 *
 * Scheme: **four-stage explicit Runge–Kutta on i∂ₜψ = Ĥψ in low-storage Horner
 * form**, evaluated on a rotating set of three float textures.
 *
 * Because Ĥ is *linear*, classical RK4 is the polynomial
 *
 *     ψ₊ = [1 + z + z²/2 + z³/6 + z⁴/24] ψ ,   z = −i·dt·Ĥ
 *
 * which Horner-factors into  P = I + z(I + (z/2)(I + (z/3)(I + z/4))). Each
 * factor is one fragment pass of the shape
 *
 *     out = ψ₀ + c·(−iĤ)(in)
 *
 * so a full step costs four 5-point-stencil passes and only three textures — no
 * k1…k4 registers and no copies, the buffer roles simply rotate. RK4's stability
 * polynomial obeys |R(iy)| ≤ 1 for |y| ≤ 2√2 and |R(iy)| < 1 for y ≳ 1.5, i.e.
 * grid-scale noise is *damped* while the physically occupied low-k modes advance
 * with O(dt⁵) phase error. That is what keeps fringes crisp for minutes instead
 * of degenerating into a checkerboard, and is why RK4 was preferred over plain
 * leapfrog (parasitic computational mode) and over split-step Fourier (no FFT in
 * this fragment pipeline).
 *
 * Open boundaries use a Complex Absorbing Potential: the factor exp(−W·dt) is
 * applied on the final pass, so the sponge is unconditionally stable however
 * strong W is.
 *
 * Units: ħ = mₑ = 1 and lattice spacing dx = 1 *cell*, so Ĥ = −½∇² + V and the
 * CFL bound is dt ≤ 2√2/(4 + Vmax). Geometry is expressed in domain-normalised
 * coordinates uv ∈ [0,1]²; a plane wave of domain momentum p has lattice phase
 * p·Δx because k_cell = p/N and x_cell = N·u.
 */

import { GLSL_PHASE_COLORS } from '@/lib/colorMap';

/** Full-screen triangle: no vertex buffers, no attribute to keep in sync. */
export const DS_VERT = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // Canonical full-screen triangle: (−1,−1), (3,−1), (−1,3).
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

/**
 * Shared geometry: barrier slab at u̅x = uBarrierX with thickness uBarrierT and
 * two rectangular apertures of width uSlitW centred on 0.5 ± uSlitSep/2.
 */
const GEOMETRY = /* glsl */ `
uniform float uBarrierX;
uniform float uBarrierT;
uniform float uSlitW;
uniform float uSlitSep;
uniform float uBarrierV;
uniform float uSponge;
uniform float uSpongeW;

/** 1.0 inside solid barrier material, 0.0 in vacuum and inside the slits. */
float q_barrier(vec2 uv) {
  float x0 = uBarrierX - 0.5 * uBarrierT;
  float x1 = uBarrierX + 0.5 * uBarrierT;
  if (uv.x < x0 || uv.x > x1) return 0.0;
  float a0 = 1.0 - step(0.5 * uSlitW, abs(uv.y - (0.5 + 0.5 * uSlitSep)));
  float a1 = 1.0 - step(0.5 * uSlitW, abs(uv.y - (0.5 - 0.5 * uSlitSep)));
  return 1.0 - clamp(a0 + a1, 0.0, 1.0);
}

/**
 * Which-path plate weight along y: 1.0 over the arm that feeds the marked slit,
 * 0.0 over the other, with a C1 cubic ramp of half-width uSlitSep/4 centred on
 * the beam axis. The apertures sit at mid ± uSlitSep/2, i.e. well inside the
 * saturated zones, so each arm leaves the injector with one definite phase and
 * the ramp adds no sharp edge to diffract.
 */
float q_tag(vec2 uv, int slit) {
  float hw = max(1e-4, 0.25 * uSlitSep);
  float u = clamp((uv.y - 0.5 + hw) / (2.0 * hw), 0.0, 1.0);
  float g = u * u * (3.0 - 2.0 * u);
  return slit == 1 ? 1.0 - g : g;
}

/** Quadratic CAP ramp on the right, top and bottom edges (0 outside the sponge). */
float q_sponge(vec2 uv) {
  float r = (uv.x - (1.0 - uSpongeW)) / uSpongeW;
  float t = (uSpongeW - uv.y) / uSpongeW;
  float b = (uv.y - (1.0 - uSpongeW)) / uSpongeW;
  float s = max(max(r, t), b);
  return s > 0.0 ? s * s : 0.0;
}

/** Total absorption rate W(uv) of the complex potential −iW. */
float q_absorb(vec2 uv) {
  return uSponge * q_sponge(uv) + 2.5 * uBarrierV * q_barrier(uv);
}
`;

/**
 * One Horner factor of the RK4 polynomial; `uCoef` walks dt/4, dt/3, dt/2, dt
 * over the four passes. `uFinal` marks the last pass, which additionally
 * applies the CAP. Dirichlet walls are implied by the out-of-range tap = 0.
 */
export const DS_STEP_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform sampler2D uBase;
uniform int uN;
uniform float uDt;
uniform float uCoef;
uniform int uFinal;
${GEOMETRY}
in vec2 vUv;
out vec4 fragColor;

vec2 q_tap(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uN || p.y >= uN) return vec2(0.0);
  return texelFetch(uState, p, 0).xy;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 psi = q_tap(c);
  // ∇²ψ with the 5-point stencil, dx = 1 cell (band [−8, 0]).
  vec2 lap = q_tap(c + ivec2(1, 0)) + q_tap(c - ivec2(1, 0))
           + q_tap(c + ivec2(0, 1)) + q_tap(c - ivec2(0, 1)) - 4.0 * psi;
  float V = uBarrierV * q_barrier(vUv);
  // ∂t ψ = −i Ĥ ψ,  Ĥψ = −½∇²ψ + Vψ ,  −½∇² = −0.5 · lap  (band [0, 4 + V])
  vec2 kin = -0.5 * lap;
  float hr = kin.x + V * psi.x;
  float hi = kin.y + V * psi.y;
  vec2 base = texelFetch(uBase, c, 0).xy;
  vec2 outp = base + uCoef * vec2(hi, -hr);
  if (uFinal == 1) outp *= exp(-q_absorb(vUv) * uDt);
  if (!(outp == outp) || any(isinf(outp))) outp = vec2(0.0);
  fragColor = vec4(outp, 0.0, 1.0);
}`;

/**
 * Inject a normalised Gaussian packet at `uInject` (domain units, Σ_cells |ψ|² =
 * 1) moving right with domain momentum `uP`, blending over the old field so
 * re-emission never destroys wavepackets that already left the source window.
 *
 * The which-path mark rides along with the emission: `uTagPhase` is applied
 * through `q_tag`, a phase plate whose C1 ramp straddles the beam axis halfway
 * between the slits, so the entire arm that feeds the marked slit leaves the
 * injector multiplied by e^{iφ} and the other arm by 1. Doing it here rather
 * than at the barrier is what makes the model exact — an older packet already in
 * flight is never re-randomised, so packet n carries its own coin e^{±iφ} and
 * only packet n's, and in the paraxial limit the arm a plane-fronted packet
 * starts in is the arm it reaches the barrier through.
 *
 * Averaging the ± coin over the ensemble leaves off-diagonal coherence cos φ,
 * hence fringe visibility V = |cos φ| against distinguishability D = |sin φ|:
 * the Greenberger–Yasinov relation V² + D² = 1, saturated at full decoherence.
 */
export const DS_EMIT_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform vec2 uInject;
uniform vec2 uSigma;
uniform float uP;
uniform float uAmp;
uniform float uTagPhase;
uniform int uTagSlit;
${GEOMETRY}
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 d = vUv - uInject;
  float rx = d.x / (2.0 * uSigma.x);
  float ry = d.y / (2.0 * uSigma.y);
  float r2 = rx * rx + ry * ry;
  float w = exp(-r2 * 1.5);
  // k_cell·x_cell = (p/N)·(N·Δu) = p·Δu.
  float phase = uP * d.x + uTagPhase * q_tag(vUv, uTagSlit);
  float amp = uAmp * exp(-r2 * 0.5);
  vec2 packet = vec2(amp * cos(phase), amp * sin(phase));
  vec2 old = texelFetch(uState, ivec2(gl_FragCoord.xy), 0).xy;
  fragColor = vec4(mix(old, packet, w), 0.0, 1.0);
}`;

/**
 * Phosphor strip: density along the detector line into a 1D float texture the
 * CPU turns into the histogram and Monte-Carlo clicks. Each output row averages
 * the lattice cells that fall inside it, so the strip resolution is free to differ
 * from the state texture size. ROWS is the strip height, G the state texture size.
 */
export const DS_SCREEN_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform int uN;
uniform int uRows;
uniform float uScreenX;
in vec2 vUv;
out vec4 fragColor;
vec2 q_tap(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uN || p.y >= uN) return vec2(0.0);
  return texelFetch(uState, p, 0).xy;
}
void main() {
  int row = int(gl_FragCoord.y - 0.5);
  int cx = int(uScreenX * float(uN));
  // Cells whose centre falls in this row's span — the same partition the CPU
  // reference uses, so the strip is an area integral and cannot moiré.
  int j0 = max(0, int(ceil(float(row) * float(uN) / float(uRows) - 0.5)));
  int j1 = min(uN - 1, max(j0, int(ceil(float(row + 1) * float(uN) / float(uRows) - 0.5)) - 1));
  int mid = (j0 + j1) / 2;
  float acc = 0.0;
  float fwd = 0.0;
  float cnt = 0.0;
  for (int i = -4; i <= 4; i++) {
    int j = mid + i;
    if (j < j0 || j > j1) continue;
    ivec2 p = ivec2(cx, j);
    vec2 a = q_tap(p);
    acc += dot(a, a);
    // x-probability current Im(ψ* ∂x ψ): separates outgoing from reflected.
    vec2 d = q_tap(p + ivec2(1, 0)) - q_tap(p - ivec2(1, 0));
    fwd += a.x * d.y - a.y * d.x;
    cnt += 1.0;
  }
  fragColor = vec4(acc / max(cnt, 1.0), fwd / max(cnt, 1.0), 0.0, 1.0);
}`;

/** Block-sum of |ψ|² into a small texture for the norm read-back. */
export const DS_REDUCE_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform int uN;
uniform int uBlock;
in vec2 vUv;
out vec4 fragColor;
vec2 q_tap(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uN || p.y >= uN) return vec2(0.0);
  return texelFetch(uState, p, 0).xy;
}
void main() {
  ivec2 origin = ivec2(gl_FragCoord.xy - 0.5) * uBlock;
  float acc = 0.0;
  for (int j = 0; j < 8; j++) {
    if (j >= uBlock) break;
    for (int i = 0; i < 8; i++) {
      if (i >= uBlock) break;
      vec2 a = q_tap(origin + ivec2(i, j));
      acc += dot(a, a);
    }
  }
  fragColor = vec4(acc, 0.0, 0.0, 1.0);
}`;

/**
 * Visible field: phase sets hue through the shared twilight wheel, |ψ|² sets
 * luminance — never the reverse, so a bright band is always real probability.
 * The tone mapping (`log(1 + 900·c·ρ) / log(1 + 900·c)`, then `lum^1.6 × 1.35`
 * over the same background) is an exact mirror of `paint()` in
 * `src/simulations/double-slit-2d/cpu.ts`; the hue comes from the platform-wide
 * `GLSL_PHASE_COLORS` wheel, whose cyclic wrap is folded into the last segment
 * rather than given one of its own the way `sampleRamp()` in `src/lib/colorMap.ts`
 * does — the same choice every GPU path in this app makes, worth ≤ 0.41 of a
 * channel and only near arg ψ = ±π.
 */
export const DS_RENDER_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform int uN;
uniform float uContrast;
uniform float uFieldAlpha;
uniform int uPhaseColor;
uniform int uPalette;
uniform int uShowBarrier;
uniform float uScreenX;
${GLSL_PHASE_COLORS}
${GEOMETRY}
in vec2 vUv;
out vec4 fragColor;
void main() {
  ivec2 c = clamp(ivec2(gl_FragCoord.xy), ivec2(0), ivec2(uN - 1));
  vec2 psi = texelFetch(uState, c, 0).xy;
  float rho = dot(psi, psi);
  // Weber-Fechner style tone mapping: fringes stay visible over 3 decades.
  float lum = clamp(log(1.0 + rho * 900.0 * uContrast) / log(1.0 + 900.0 * uContrast), 0.0, 1.0);
  vec3 col = uPhaseColor == 1
      ? q_phaseColor(atan(psi.y, psi.x), uPalette)
      : vec3(0.62, 0.85, 1.0);
  vec3 bg = vec3(0.024, 0.031, 0.051);
  vec3 c3 = bg + col * pow(lum, 1.6) * 1.35;

  if (uShowBarrier == 1) {
    float b = q_barrier(vUv);
    c3 = mix(c3, vec3(0.075, 0.086, 0.12), smoothstep(0.0, 1.0, b) * 0.92);
    float edge = clamp(fwidth(b) * 4.0, 0.0, 1.0);
    c3 += vec3(0.55, 0.75, 0.95) * edge * 0.30;
  }
  float line = 1.0 - step(1.5 / float(uN), abs(vUv.x - uScreenX));
  c3 = mix(c3, vec3(0.35, 0.95, 0.75), line * 0.5);

  fragColor = vec4(mix(bg, c3, uFieldAlpha), 1.0);
}`;

export const DS_PROGRAMS = {
  vert: DS_VERT,
  step: DS_STEP_FRAG,
  emit: DS_EMIT_FRAG,
  screen: DS_SCREEN_FRAG,
  reduce: DS_REDUCE_FRAG,
  render: DS_RENDER_FRAG,
} as const;

export type DSProgramKey = keyof typeof DS_PROGRAMS;
