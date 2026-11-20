/**
 * molecular.ts — GLSL ES 3.00 sources for Sim 9 (Molecular Orbitals & LCAO Bonding).
 *
 * Exported as plain template strings: the simulation owns the WebGL plumbing and
 * nothing here touches React, three.js or the DOM, so the module is SSR-safe.
 *
 * Two programs:
 *   1. `MOLECULAR_RAYMARCH_{VERT,FRAG}` — fullscreen-triangle volumetric march of
 *      |ψ±(r)|² for the two-centre MO. Emission–absorption accumulation, signed-phase
 *      dual colouring through the shared twilight/cividis wheel, exposure + gamma, an
 *      iso-shell mode, nucleus markers and the optional nodal-plane sheet. Purely
 *      analytic (no textures, no render targets), so it needs neither float textures
 *      nor extensions — the Canvas capability gate is simply "is there a WebGL2 context".
 *   2. `MOLECULAR_CLOUD_{VERT,FRAG}` — GL_POINTS pass for the |ψ|²-sampled point cloud:
 *      additive blending (order independent), perspective point sizing.
 *
 * Conventions shared with `src/engine/physics/lcao.ts` (atomic units, bond axis = z,
 * midpoint = origin, nucleus A at z = −R/2):
 *   1s  : φ = √(ζ³/π) e^{−ζr}
 *   2pz : φ = ζ^{5/2}/√(32π) · z e^{−ζr/2}
 *   2px : φ = ζ^{5/2}/√(32π) · x e^{−ζr/2}
 *   ψ±  = N±(φ_A ± φ_B),   N± = 1/√(2(1 ± S))
 */

import { GLSL_PHASE_COLORS } from '@/lib/colorMap';

/* ------------------------------------------------------------------ */
/* Volumetric raymarch                                                 */
/* ------------------------------------------------------------------ */

/**
 * Fullscreen triangle generated from `gl_VertexID` — the Canvas needs no buffers,
 * no VAO and no attributes for the volumetric pass.
 */
export const MOLECULAR_RAYMARCH_VERT = `#version 300 es
precision highp float;
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

/**
 * Camera: `uFocal = 1/tan(fovY/2)`, `uAspect = w/h`, basis columns right/up/fwd with
 * uFwd pointing from the camera into the scene. The ray through NDC (x, y) is
 * right·(x·aspect/focal) + up·(y/focal) + fwd.
 */
export const MOLECULAR_RAYMARCH_FRAG = `#version 300 es
precision highp float;
precision highp int;

in vec2 vNdc;
out vec4 fragColor;

uniform vec3  uCamPos;
uniform vec3  uRight;
uniform vec3  uUp;
uniform vec3  uFwd;
uniform float uFocal;
uniform float uAspect;

uniform float uHalfR;      // R/2 in a0
uniform float uZeta;       // AO exponent
uniform float uSign;       // +1 -> phi_A + phi_B, -1 -> phi_A - phi_B
uniform int   uKind;       // 0 = 1s, 1 = 2pz, 2 = 2px
uniform float uNorm;       // N_pm
uniform float uPeak;       // max |psi|^2, normalises the density
uniform float uBound;      // radius of the marched bounding sphere

uniform float uExposure;
uniform float uGamma;
uniform float uIso;        // iso level as a fraction of uPeak
uniform int   uMode;       // 0 = volumetric, 1 = iso-shell
uniform int   uMono;
uniform int   uPalette;    // 0 = twilight, 1 = cividis
uniform int   uShowNuclei;
uniform int   uNodeMode;   // 0 = off, 1 = plane z = 0, 2 = plane x = 0
uniform float uTime;

${GLSL_PHASE_COLORS}

const float PI = 3.141592653589793;
const int   STEPS = 128;

float aoVal(int kind, float zeta, vec3 p) {
  float r = length(p);
  if (kind == 0) return sqrt(zeta * zeta * zeta / PI) * exp(-zeta * r);
  float n = pow(zeta, 2.5) / sqrt(32.0 * PI) * exp(-0.5 * zeta * r);
  return kind == 1 ? n * p.z : n * p.x;
}

/** Signed MO amplitude, origin at the bond midpoint, A at z = -R/2. */
float moAmplitude(vec3 p) {
  float a = aoVal(uKind, uZeta, p + vec3(0.0, 0.0, uHalfR));
  float b = aoVal(uKind, uZeta, p - vec3(0.0, 0.0, uHalfR));
  return uNorm * (a + uSign * b);
}

float moDensity(vec3 p) {
  float v = moAmplitude(p);
  return v * v;
}

float hash12(vec2 q) {
  vec3 p3 = fract(vec3(q.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/** Entry / exit distances of the ray with the sphere (c centre, r radius). */
vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 rel = c - ro;
  float tca = dot(rel, rd);
  float d2 = dot(rel, rel) - tca * tca;
  float r2 = r * r;
  if (d2 > r2) return vec2(-1.0);
  float thc = sqrt(r2 - d2);
  return vec2(tca - thc, tca + thc);
}

/** Warm lobe for psi > 0, cool lobe for psi < 0 — the signed-phase dual colouring. */
vec3 phaseTint(float psi, float lum) {
  if (uMono == 1) return vec3(lum, lum, lum) * vec3(0.80, 0.88, 1.0);
  float angle = psi >= 0.0 ? 1.5707963 : -1.5707963;
  return q_phaseColor(angle, uPalette);
}

void main() {
  vec2 g = vNdc * vec2(uAspect, 1.0) / max(uFocal, 0.2);
  vec3 rd = normalize(uRight * g.x + uUp * g.y + uFwd);
  vec3 ro = uCamPos;

  float jitter = hash12(gl_FragCoord.xy + fract(uTime) * 91.7);

  // Obsidian field with a soft vignette, so the stage reads as deep space.
  float vr = length(vNdc) * 0.72;
  vec3 bg = mix(vec3(0.052, 0.045, 0.085), vec3(0.014, 0.017, 0.032), clamp(vr, 0.0, 1.0));
  bg += 0.022 * vec3(0.35, 0.55, 1.0) * exp(-3.0 * vr);

  vec2 span = raySphere(ro, rd, vec3(0.0), uBound);
  vec4 acc = vec4(0.0);

  vec3 nucA = vec3(0.0, 0.0, -uHalfR);
  vec3 nucB = vec3(0.0, 0.0, uHalfR);
  float nucRad = 0.34;
  vec2 hitA = uShowNuclei == 1 ? raySphere(ro, rd, nucA, nucRad) : vec2(-1.0);
  vec2 hitB = uShowNuclei == 1 ? raySphere(ro, rd, nucB, nucRad) : vec2(-1.0);
  bool punchedA = false;
  bool punchedB = false;

  // span.x is negative when the camera sits inside the sphere (zoomed in, or a
  // long bond at small Z), so the march must start at the camera itself.
  float tEnter = max(span.x, 0.0);
  if (span.y > tEnter) {
    float stepLen = max((span.y - tEnter) / float(STEPS), 1e-4);
    float t = tEnter + stepLen * jitter;
    float inv = 1.0 / max(uPeak, 1e-12);
    vec3 light = normalize(vec3(-0.45, 0.72, 0.52));

    for (int i = 0; i < STEPS; i++) {
      if (t > span.y || acc.a > 0.985) break;
      vec3 p = ro + rd * t;
      float psi = moAmplitude(p);
      float rho = psi * psi * inv;

      float alpha = 0.0;
      vec3 tint;

      if (uMode == 1) {
        // Iso-shell: thin band around |psi|^2 = uIso * peak, gradient-shaded.
        float w = 0.05;
        float band = exp(-pow((rho - uIso) / w, 2.0));
        vec3 grad = vec3(
          moDensity(p + vec3(0.06, 0.0, 0.0)) - moDensity(p - vec3(0.06, 0.0, 0.0)),
          moDensity(p + vec3(0.0, 0.06, 0.0)) - moDensity(p - vec3(0.0, 0.06, 0.0)),
          moDensity(p + vec3(0.0, 0.0, 0.06)) - moDensity(p - vec3(0.0, 0.0, 0.06))
        );
        float gmag = length(grad);
        vec3 nrm = gmag > 1e-7 ? grad / gmag : -rd;
        if (dot(nrm, rd) > 0.0) nrm = -nrm;
        float shade = 0.30 + 0.70 * max(dot(nrm, light), 0.0);
        alpha = band * clamp(uExposure, 0.05, 6.0) * stepLen * 6.0;
        tint = phaseTint(psi, 1.0) * shade;
      } else {
        // Volumetric: quadratic + linear response keeps core and tails both visible.
        float dens = rho * rho * 1.6 + rho * 0.55;
        alpha = 1.0 - exp(-dens * uExposure * stepLen * 2.6);
        tint = phaseTint(psi, clamp(0.25 + rho * 1.25, 0.08, 1.0));
      }

      alpha = clamp(alpha, 0.0, 1.0);
      if (alpha > 0.0008) {
        acc.rgb += (1.0 - acc.a) * tint * alpha;
        acc.a += (1.0 - acc.a) * alpha;
      }

      // Nucleus markers, composited as the ray crosses them.
      if (!punchedA && hitA.x > 0.0 && t >= hitA.x) {
        punchedA = true;
        float d = length(p - nucA);
        float m = clamp(1.0 - d / nucRad, 0.0, 1.0);
        float a = clamp(m * 1.7, 0.0, 1.0);
        vec3 core = vec3(1.0, 0.87, 0.62) * (0.35 + 2.0 * m * m);
        acc.rgb = acc.rgb * (1.0 - a) + core * a;
        acc.a = clamp(acc.a + a * 0.95, 0.0, 1.0);
      }
      if (!punchedB && hitB.x > 0.0 && t >= hitB.x) {
        punchedB = true;
        float d = length(p - nucB);
        float m = clamp(1.0 - d / nucRad, 0.0, 1.0);
        float a = clamp(m * 1.7, 0.0, 1.0);
        vec3 core = vec3(1.0, 0.87, 0.62) * (0.35 + 2.0 * m * m);
        acc.rgb = acc.rgb * (1.0 - a) + core * a;
        acc.a = clamp(acc.a + a * 0.95, 0.0, 1.0);
      }

      t += stepLen;
    }

    // Nodal-plane sheet: z = 0 for sigma*, x = 0 for the 2p pi lobes.
    if (uNodeMode != 0) {
      vec3 n = uNodeMode == 1 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
      float dn = dot(rd, n);
      if (abs(dn) > 1e-4) {
        float tt = -dot(ro, n) / dn;
        if (tt > tEnter && tt < span.y) {
          vec3 hp = ro + rd * tt;
          float ext = uHalfR + 4.5;
          vec2 sc = uNodeMode == 1 ? vec2(hp.x, hp.y) : vec2(hp.y, hp.z);
          float far = max(abs(sc.x), abs(sc.y) / 0.75);
          if (far < ext) {
            vec2 gq = abs(fract(sc * 0.5) - 0.5);
            float grid = smoothstep(0.055, 0.0, min(gq.x, gq.y));
            float edge = 1.0 - smoothstep(ext * 0.7, ext, far);
            vec3 sheet = vec3(0.40, 0.70, 0.98) * 0.10 + vec3(0.52, 0.38, 0.92) * grid * 0.55;
            float a = (0.15 + grid * 0.45) * edge * clamp(1.0 - acc.a, 0.0, 1.0);
            acc.rgb = acc.rgb * (1.0 - a) + sheet * a;
            acc.a = clamp(acc.a + a, 0.0, 1.0);
          }
        }
      }
    }
  } else if (uShowNuclei == 1) {
    // Camera inside the marching sphere: markers still resolve.
    if (hitA.y > 0.0) acc.rgb += vec3(0.9, 0.78, 0.55) * 0.4;
    if (hitB.y > 0.0) acc.rgb += vec3(0.9, 0.78, 0.55) * 0.4;
  }

  vec3 col = bg * (1.0 - clamp(acc.a, 0.0, 1.0)) + acc.rgb;
  col = pow(max(col, vec3(0.0)), vec3(1.0 / max(uGamma, 0.4)));
  fragColor = vec4(col, 1.0);
}`;

/* ------------------------------------------------------------------ */
/* Point cloud (GPU path)                                              */
/* ------------------------------------------------------------------ */

export const MOLECULAR_CLOUD_VERT = `#version 300 es
precision highp float;

in vec3 aPos;
in float aVal;

uniform vec3  uCamPos;
uniform vec3  uRight;
uniform vec3  uUp;
uniform vec3  uFwd;
uniform float uFocal;
uniform float uAspect;
uniform float uPix;       // viewport height in device pixels
uniform float uSize;      // world-space point radius
uniform float uPeakAmp;

out float vMag;
out float vSign;
out float vFade;

void main() {
  vec3 d = aPos - uCamPos;
  float xc = dot(d, uRight);
  float yc = dot(d, uUp);
  float zc = max(dot(d, uFwd), 0.08);
  gl_Position = vec4(xc * uFocal / uAspect, yc * uFocal, clamp(zc * 0.06 - 1.0, -0.99, 0.99), zc);
  float a = abs(aVal);
  vMag = clamp(a / max(uPeakAmp, 1e-9), 0.0, 1.0);
  vSign = aVal >= 0.0 ? 1.0 : -1.0;
  vFade = clamp((26.0 - zc) / 14.0, 0.2, 1.0);
  gl_PointSize = clamp(uSize * uFocal * uPix / (2.0 * zc), 1.0, 22.0);
}`;

export const MOLECULAR_CLOUD_FRAG = `#version 300 es
precision highp float;

in float vMag;
in float vSign;
in float vFade;
out vec4 fragColor;

uniform int   uMono;
uniform int   uPalette;
uniform float uExposure;
uniform float uGamma;

${GLSL_PHASE_COLORS}

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float core = 1.0 - r2;
  float w = pow(core, 1.7) * (0.12 + vMag * 0.95) * clamp(uExposure, 0.05, 4.0) * vFade;
  float angle = vSign >= 0.0 ? 1.5707963 : -1.5707963;
  vec3 col = uMono == 1
    ? vec3(0.66, 0.80, 1.0) * (0.30 + vMag * 0.9)
    : q_phaseColor(angle, uPalette) * (0.40 + 0.75 * vMag);
  col = pow(max(col, vec3(0.0)), vec3(1.0 / max(uGamma, 0.4)));
  fragColor = vec4(col * w, w);
}`;

/* ------------------------------------------------------------------ */
/* CPU fallback styling (no WebGL2 at all)                             */
/* ------------------------------------------------------------------ */

/**
 * Lobe colours for the Canvas2D fallback point cloud — the same warm/cool split the
 * twilight wheel gives at ±90° of phase, so the degraded path still reads identically.
 */
export const CPU_LOBE_RGB = {
  positive: [120, 176, 255] as const,
  negative: [255, 128, 148] as const,
  positiveMono: [205, 220, 250] as const,
  negativeMono: [232, 238, 252] as const,
} as const;

/** Fallback stage backdrop, matching the shader's vignette. */
export const CPU_BACKGROUND =
  'radial-gradient(120% 90% at 50% 42%, #0d1020 0%, #070912 55%, #04050b 100%)';
