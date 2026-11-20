/**
 * Orbitalis 3D — GLSL ES 3.00 programs.
 *
 * The renderer is raw WebGL2 rather than three.js because the volumetric pass
 * needs a 3D float texture per eigenstate slot and a hand-written raymarch loop.
 *
 * Pipeline (§5.3 of the PRD):
 *   1. Each active |n ℓ m⟩ is baked ONCE into an RGBA16F 3D texture holding the
 *   complex amplitude (Re ψ, Im ψ), normalised by a shared peak so relative
 *   densities between slots stay honest. Amplitude/phase/field edits NEVER
 *   re-bake.
 *   2. The fragment shader recombines the slots every frame with the analytic
 *      propagator:   Ψ(x,t) = Σ_k c_k e^{-i E_k t} ψ_k(x)   (ℏ = 1)
 *      so a slider drag costs one uniform upload.
 *   3. |Ψ|² drives absorption; arg(Ψ) drives the cyclic phase wheel shared with
 *      the CPU-side colour map (`lib/colorMap.ts` GLSL mirror).
 *
 * GPUs without a float-texture path get the packed RGBA8 encoding (16 bits per
 * component split across two bytes) selected at compile time with `packed`.
 */

import { GLSL_PHASE_COLORS } from '@/lib/colorMap';

/** Fullscreen triangle — no vertex buffer, positions from gl_VertexID. */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const UNIFORMS = /* glsl */ `
#define MAX_SLOTS 4

in vec2 vUv;
out vec4 fragColor;

uniform sampler3D uTex[MAX_SLOTS];   // slot k: ψ_{nℓm} (see PACK note)
uniform int   uCount;                // active slots
uniform float uOmega[MAX_SLOTS];     // E_k in atomic units (ℏ = 1)
uniform float uAmp[MAX_SLOTS];       // |c_k|
uniform float uPhase[MAX_SLOTS];     // arg(c_k)
uniform int   uPalette;              // 0 = twilight, 1 = cividis
uniform float uTime;                 // simulation time, atomic units
uniform float uRBox;                 // scene half-extent in a₀
uniform float uExposure;
uniform float uGamma;
uniform float uIsoLevel;             // 0..1 perceptual isosurface threshold
uniform float uDensity;              // density gain (volume + slice)
uniform int   uOctant;               // cutaway wedge
uniform int   uSliceAxis;            // 0 = z-normal (xy), 1 = y-normal (xz), 2 = x-normal (yz)
uniform float uSliceOffset;          // fraction of rBox
uniform int   uMonochrome;
uniform int   uShowAxes;
uniform mat4  uInvViewProj;
uniform vec3  uCamPos;
uniform vec2  uResolution;

${GLSL_PHASE_COLORS}
`;

/** `PACKED8` reassembles the 16-bit split encoding written by bake.ts. */
const SAMPLER = /* glsl */ `
vec2 psiSlot(int k, vec3 p) {
  vec3 tc = clamp(p / (2.0 * uRBox) + 0.5, vec3(0.002), vec3(0.998));
  vec4 t = texture(uTex[k], tc);
#ifdef PACKED8
  float re = (t.r + t.b / 255.0) * 2.0 - 1.0;
  float im = (t.g + t.a / 255.0) * 2.0 - 1.0;
  return vec2(re, im);
#else
  return t.rg;
#endif
}

/* Ψ(x,t) for the whole superposition — the heart of the renderer. */
vec2 psiVec(vec3 p) {
  float re = 0.0;
  float im = 0.0;
  for (int k = 0; k < MAX_SLOTS; k++) {
    if (k >= uCount) break;
    if (uAmp[k] <= 0.0) continue;
    vec2 v = psiSlot(k, p);
    // c_k·e^{-iE_k t} = |c|(cos(φ − E t) + i·sin(φ − E t))
    float ang = uPhase[k] - uOmega[k] * uTime;
    float cs = cos(ang) * uAmp[k];
    float sn = sin(ang) * uAmp[k];
    re += cs * v.x - sn * v.y;
    im += cs * v.y + sn * v.x;
  }
  return vec2(re, im);
}

void psiAt(vec3 p, out float density, out float phase) {
  vec2 v = psiVec(p);
  density = dot(v, v);
  phase = atan(v.y, v.x);
}

vec3 rayDir(vec2 uv) {
  vec4 far = uInvViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 p = far.xyz / far.w;
  return normalize(p - uCamPos);
}

vec3 tonemap(vec3 c) {
  c = max(vec3(0.0), c * uExposure);
  c = c / (1.0 + c * 0.45);
  return pow(c, vec3(1.0 / max(0.6, uGamma)));
}

bool insideBox(vec3 p) {
  return max(max(abs(p.x), abs(p.y)), abs(p.z)) < uRBox;
}

vec2 boxIntersect(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / (rd + vec3(1e-8));
  vec3 a = (-uRBox - ro) * inv;
  vec3 b = (uRBox - ro) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  float t0 = max(max(lo.x, lo.y), lo.z);
  float t1 = min(min(hi.x, hi.y), hi.z);
  return vec2(clamp(t0, 0.0, max(t1, 0.0)), t1);
}

vec3 planeNormal() {
  if (uSliceAxis == 0) return vec3(0.0, 0.0, 1.0);
  if (uSliceAxis == 1) return vec3(0.0, 1.0, 0.0);
  return vec3(1.0, 0.0, 0.0);
}

/* In-plane coordinates of a point on the active slice, used for the ruler. */
vec2 planeCoords(vec3 p) {
  if (uSliceAxis == 0) return p.xy;
  if (uSliceAxis == 1) return vec2(p.x, p.z);
  return vec2(p.y, p.z);
}

vec3 axisGlow(vec3 p, float t) {
  if (uShowAxes == 0) return vec3(0.0);
  float px = max(0.0018, 2.2 / uResolution.x);
  float ax = smoothstep(px, 0.0, abs(p.y)) * smoothstep(px, 0.0, abs(p.z));
  float ay = smoothstep(px, 0.0, abs(p.x)) * smoothstep(px, 0.0, abs(p.z));
  float az = smoothstep(px, 0.0, abs(p.x)) * smoothstep(px, 0.0, abs(p.y));
  float fade = 1.0 / (1.0 + t * t * 0.004 / max(uRBox, 1.0));
  return (vec3(0.92, 0.42, 0.52) * ax + vec3(0.52, 0.88, 0.55) * ay + vec3(0.45, 0.62, 0.98) * az) * fade * 0.85;
}

vec3 baseColour(float phase) {
  return uMonochrome == 1 ? vec3(0.60, 0.84, 0.96) : q_phaseColor(phase, uPalette);
}
`;

/* ------------------------------- volume ---------------------------------- */

/**
 * Emission–absorption raymarch. `steps` is compiled per quality tier so the
 * inner loop stays unrollable; the integrator terminates as soon as the ray is
 * opaque, which is what keeps dense 1s clouds cheap.
 */
export function buildVolumeSource(steps: number): string {
  return `
vec3 marchVolume(vec3 ro, vec3 rd) {
  vec2 span = boxIntersect(ro, rd);
  if (span.y <= span.x) return vec3(0.0);
  const int STEPS = ${Math.max(24, Math.min(256, steps | 0))};
  float dt = (span.y - span.x) / float(STEPS);
  float ds = dt * length(rd);
  vec3 acc = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (span.x + (float(i) + 0.5) * dt);
    if (uOctant == 1 && p.x > 0.0 && p.y > 0.0 && p.z > 0.0) continue;
    float d, ph;
    psiAt(p, d, ph);
    float rho = d * uDensity;
    if (rho < 4e-4) continue;
    vec3 col = baseColour(ph);
    float a = clamp(rho * ds * 1.35, 0.0, 1.0);
    acc += (1.0 - alpha) * col * a;
    alpha += (1.0 - alpha) * a;
    if (alpha > 0.985) break;
  }
  return acc;
}

void main() {
  vec3 rd = rayDir(vUv);
  vec2 span = boxIntersect(uCamPos, rd);
  vec3 col = marchVolume(uCamPos, rd);
  float glow = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  vec3 bg = vec3(0.012, 0.017, 0.030) * (1.0 - 0.4 * length(vUv - 0.5));
  vec3 outc = mix(bg, col, max(glow, 0.0)) + col * 0.55;
  outc += axisGlow(uCamPos + rd * max(span.x, 0.0), max(span.x, 0.0));
  fragColor = vec4(tonemap(outc), 1.0);
}
`;
}

/* ----------------------------- isosurface -------------------------------- */

export const ISOSURFACE_BODY = /* glsl */ `
float isoThreshold() {
  float iso = clamp(uIsoLevel, 0.002, 0.998);
  return pow(iso, 2.4) * 1.6 / max(uDensity, 1e-4);
}

bool hitIso(vec3 ro, vec3 rd, out vec3 hp, out float hphase) {
  hp = ro;
  hphase = 0.0;
  vec2 span = boxIntersect(ro, rd);
  if (span.y <= span.x) return false;
  float thr = isoThreshold();
  const int STEPS = 160;
  float dt = (span.y - span.x) / float(STEPS);
  float prev = -1.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (span.x + float(i) * dt);
    if (uOctant == 1 && p.x > 0.0 && p.y > 0.0 && p.z > 0.0) { prev = -1.0; continue; }
    float d, ph;
    psiAt(p, d, ph);
    if (prev >= 0.0 && ((prev < thr) != (d * uDensity < thr))) {
      float t0 = span.x + float(i - 1) * dt;
      float t1 = span.x + float(i) * dt;
      for (int j = 0; j < 5; j++) {
        float tm = 0.5 * (t0 + t1);
        float dm, pm;
        psiAt(ro + rd * tm, dm, pm);
        if (dm * uDensity < thr) t0 = tm; else t1 = tm;
      }
      float th = 0.5 * (t0 + t1);
      hp = ro + rd * th;
      if (!insideBox(hp)) return false;
      float hd;
      psiAt(hp, hd, hphase);
      return true;
    }
    prev = d * uDensity;
  }
  return false;
}

vec3 isoNormal(vec3 p) {
  float e = max(uRBox * 0.0045, 1e-3);
  float d, t;
  psiAt(p + vec3(e, 0.0, 0.0), d, t); float px = d;
  psiAt(p - vec3(e, 0.0, 0.0), d, t); float nx = d;
  psiAt(p + vec3(0.0, e, 0.0), d, t); float py = d;
  psiAt(p - vec3(0.0, e, 0.0), d, t); float ny = d;
  psiAt(p + vec3(0.0, 0.0, e), d, t); float pz = d;
  psiAt(p - vec3(0.0, 0.0, e), d, t); float nz = d;
  vec3 g = vec3(px - nx, py - ny, pz - nz);
  float l = length(g);
  if (l < 1e-9) return normalize(uCamPos - p);
  return g / l;
}

vec3 shadeIso(vec3 p, vec3 n, float phase) {
  vec3 V = normalize(uCamPos - p);
  float facing = max(dot(n, V), 0.0);
  vec3 base = baseColour(phase);
  vec3 L1 = normalize(vec3(0.5, 0.8, 0.35));
  vec3 L2 = normalize(vec3(-0.65, -0.2, -0.5));
  float diff = 0.5 * max(dot(n, L1), 0.0) + 0.16 * max(dot(n, L2), 0.0) + 0.26;
  vec3 H = normalize(L1 + V);
  float spec = pow(max(dot(n, H), 0.0), 48.0) * 0.6;
  float fres = pow(1.0 - facing, 2.8);
  vec3 col = base * diff + vec3(spec) + base * fres * 0.85;
  // Interior of the cutaway wedge reads darker so the octant cut is legible.
  float wedge = step(0.0, min(min(p.x, p.y), p.z)) * float(uOctant);
  col *= mix(1.0, 0.55, wedge);
  return col;
}

void main() {
  vec3 rd = rayDir(vUv);
  vec3 col = vec3(0.016, 0.021, 0.034);
  vec3 hp;
  float hph;
  if (hitIso(uCamPos, rd, hp, hph)) {
    vec3 n = isoNormal(hp);
    col = shadeIso(hp, n, hph);
  }
  vec2 span = boxIntersect(uCamPos, rd);
  col += axisGlow(uCamPos + rd * max(span.x, 0.0), max(span.x, 0.0));
  fragColor = vec4(tonemap(col), 1.0);
}
`;

/* -------------------------------- slice ---------------------------------- */

export const SLICE_BODY = /* glsl */ `
vec3 sliceColour(vec3 p) {
  float d, ph;
  psiAt(p, d, ph);
  float rho = clamp(d * uDensity, 0.0, 1.0);
  vec3 col = baseColour(ph) * rho;

  // Nodal surfaces show up as ridges in |∇ρ| — the "where does ψ change sign"
  // read-out. Gated on density so empty space costs a single evaluation.
  if (rho > 0.002) {
    float e = max(uRBox * 0.012, 1e-3);
    float t;
    float d0;
    psiAt(p + vec3(e, 0.0, 0.0), d0, t);
    float dx = d0;
    psiAt(p - vec3(e, 0.0, 0.0), d0, t);
    float ex = dx - d0;
    psiAt(p + vec3(0.0, e, 0.0), d0, t);
    float dy = d0;
    psiAt(p - vec3(0.0, e, 0.0), d0, t);
    float ey = dy - d0;
    psiAt(p + vec3(0.0, 0.0, e), d0, t);
    float dz = d0;
    psiAt(p - vec3(0.0, 0.0, e), d0, t);
    float ez = dz - d0;
    float g = length(vec3(ex, ey, ez)) / e;
    col += vec3(0.99, 0.76, 0.30) * clamp(g * 0.22, 0.0, 1.0) * 0.5;
  }
  return col;
}

void main() {
  vec3 rd = rayDir(vUv);
  vec3 nrm = planeNormal();
  float off = uSliceOffset * uRBox;
  float denom = dot(rd, nrm);
  vec3 bg = vec3(0.014, 0.019, 0.032);
  if (abs(denom) < 1e-5) {
    fragColor = vec4(bg + axisGlow(uCamPos, 0.0), 1.0);
    return;
  }
  float t = (off - dot(nrm, uCamPos)) / denom;
  if (t <= 0.0) {
    fragColor = vec4(bg + axisGlow(uCamPos, 0.0), 1.0);
    return;
  }
  vec3 p = uCamPos + rd * t;
  if (!insideBox(p)) {
    fragColor = vec4(bg + axisGlow(uCamPos + rd * max(boxIntersect(uCamPos, rd).x, 0.0), max(boxIntersect(uCamPos, rd).x, 0.0)), 1.0);
    return;
  }
  vec3 col = sliceColour(p);

  // Reference ruler in the plane, one cell per rBox/5.
  vec2 pc = planeCoords(p);
  float cell = uRBox / 5.0;
  vec2 g2 = abs(fract(pc / cell + 0.5) - 0.5) * cell;
  float grid = 1.0 - smoothstep(0.0, max(uRBox * 0.006, 1e-3), min(g2.x, g2.y));
  col += vec3(0.085, 0.115, 0.165) * grid;
  // Faint box outline so the slice reads as a cut through the volume.
  vec2 edge = min(abs(abs(pc) - uRBox), vec2(1e6));
  col += vec3(0.25, 0.55, 0.6) * (1.0 - smoothstep(0.0, max(uRBox * 0.008, 1e-3), min(edge.x, edge.y))) * 0.5;

  col += axisGlow(p, t);
  fragColor = vec4(tonemap(col), 1.0);
}
`;

/* ------------------------------- points ---------------------------------- */

/**
 * Sampling cloud + detector dots. Attributes: position (a₀), phase, intensity,
 * point size. Additive blending, depth-tested against nothing (single pass).
 */
export const POINTS_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aMeta;
layout(location = 2) in float aSize;
uniform mat4 uViewProj;
uniform float uScale;
out float vPhase;
out float vIntensity;
void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  gl_Position = clip;
  float w = max(0.4, clip.w / 60.0);
  gl_PointSize = clamp(aSize * uScale / w, 1.0, 16.0);
  vPhase = aMeta.x;
  vIntensity = aMeta.y;
}
`;

export const POINTS_FS = /* glsl */ `#version 300 es
precision highp float;
${GLSL_PHASE_COLORS}
in float vPhase;
in float vIntensity;
uniform int uPalette;
uniform int uMonochrome;
uniform vec3 uTint;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float falloff = exp(-r2 * 2.4);
  vec3 col = uMonochrome == 1 ? uTint : q_phaseColor(vPhase, uPalette);
  col = mix(uTint, col, 0.8);
  float a = falloff * clamp(vIntensity, 0.0, 1.0);
  fragColor = vec4(col * a, a);
}
`;

/* ----------------------------- streamlines -------------------------------- */

/** Probability-current streamlines, integrated on the CPU (exact ψ). */
export const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aT;
uniform mat4 uViewProj;
out float vT;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vT = aT;
}
`;

export const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
in float vT;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(uColor * vT, vT * 0.9);
}
`;

/* ---------------------------- assembly helpers --------------------------- */

function assemble(body: string, packed: boolean): string {
  return `#version 300 es
precision highp float;
precision highp sampler3D;
${packed ? '#define PACKED8 1' : ''}
${UNIFORMS}
${SAMPLER}
${body}
`;
}

export const VOLUME_FRAGS: Record<'high' | 'balanced' | 'low', (packed: boolean) => string> = {
  high: (packed) => assemble(buildVolumeSource(128), packed),
  balanced: (packed) => assemble(buildVolumeSource(96), packed),
  low: (packed) => assemble(buildVolumeSource(64), packed),
};

export const ISOSURFACE_FRAG = (packed: boolean) => assemble(ISOSURFACE_BODY, packed);
export const SLICE_FRAG = (packed: boolean) => assemble(SLICE_BODY, packed);

export const VOLUME_STEPS: Record<'high' | 'balanced' | 'low', number> = {
  high: 128,
  balanced: 96,
  low: 64,
};
