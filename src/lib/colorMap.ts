/**
 * Perceptually-uniform phase colour science (§6).
 *
 * HSV rainbows inject fake luminance bands around yellow and cyan, which the eye
 * misreads as extra probability density. Quantahedron therefore maps arg(ψ) to
 * *hue only* on a cyclic twilight wheel and |ψ|² to luminance/opacity.
 * `cividis` is the colourblind-safe alternative (blue→gold, monotonic luminance).
 */

export type Palette = 'twilight' | 'cividis';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Twilight-cyclic control points (perceptually spaced, hue only). */
const TWILIGHT: RGB[] = [
  { r: 0.93, g: 0.79, b: 0.72 }, // 0
  { r: 0.99, g: 0.55, b: 0.55 }, // 1
  { r: 0.75, g: 0.36, b: 0.66 }, // 2
  { r: 0.42, g: 0.31, b: 0.72 }, // 3
  { r: 0.20, g: 0.42, b: 0.83 }, // 4
  { r: 0.29, g: 0.68, b: 0.86 }, // 5
  { r: 0.52, g: 0.85, b: 0.72 }, // 6
  { r: 0.93, g: 0.79, b: 0.72 }, // 7 (= 0)
];

/** Cividis-safe cyclic approximation (blue → grey → gold, monotonic luma). */
const CIVIDIS: RGB[] = [
  { r: 0.0, g: 0.13, b: 0.32 },
  { r: 0.19, g: 0.3, b: 0.45 },
  { r: 0.42, g: 0.46, b: 0.49 },
  { r: 0.66, g: 0.62, b: 0.46 },
  { r: 0.9, g: 0.79, b: 0.3 },
  { r: 1.0, g: 0.92, b: 0.42 },
  { r: 0.9, g: 0.79, b: 0.3 },
  { r: 0.42, g: 0.46, b: 0.49 },
  { r: 0.19, g: 0.3, b: 0.45 },
  { r: 0.0, g: 0.13, b: 0.32 },
];

function sampleRamp(stops: RGB[], u: number): RGB {
  const n = stops.length - 1;
  const t = Math.max(0, Math.min(0.999999, u)) * n;
  const i = Math.floor(t);
  const f = t - i;
  const a = stops[i];
  const b = stops[i + 1];
  return {
    r: a.r + (b.r - a.r) * f,
    g: a.g + (b.g - a.g) * f,
    b: a.b + (b.b - a.b) * f,
  };
}

/** Phase angle (radians) → cyclic hue coordinate in [0,1). */
export function phaseToUnit(angle: number): number {
  const u = angle / (Math.PI * 2) + 0.5;
  return u - Math.floor(u);
}

export function phaseColor(angle: number, palette: Palette = 'twilight'): RGB {
  const u = phaseToUnit(angle);
  return sampleRamp(palette === 'cividis' ? CIVIDIS : TWILIGHT, u);
}

/**
 * Density-corrected colour: phase sets hue, |ψ|² sets luminance/alpha — never
 * the other way round, so bright bands always mean real probability.
 */
export function densityPhaseColor(
  angle: number,
  density: number,
  palette: Palette = 'twilight',
  exposure = 1,
  gamma = 2.2,
): RGB & { a: number } {
  const base = phaseColor(angle, palette);
  const l = Math.pow(Math.max(0, Math.min(1, density * exposure)), 1 / gamma);
  return { r: base.r * l, g: base.g * l, b: base.b * l, a: l };
}

export function rgbCss(c: RGB, alpha = 1): string {
  const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${alpha.toFixed(3)})`;
}

/**
 * GLSL mirror of the same wheel, injected into fragment shaders.
 *
 * The stop tables above are the single source of truth: this string is generated
 * from them, so the CPU canvas and the GPU raymarchers cannot drift into two
 * different hue wheels (which they had, until the closing segment of each cyclic
 * ramp was transcribed by hand and dropped).
 */
function glslWheel(fnName: string, prefix: string, stops: RGB[]): string {
  const segments = stops.length - 1;
  const num = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const decl = stops
    .map((s, i) => `    const vec3 ${prefix}${i} = vec3(${num(s.r)}, ${num(s.g)}, ${num(s.b)});`)
    .join('\n');
  const chain = Array.from({ length: segments - 1 }, (_, j) => {
    const i = j + 1;
    return `    ${j === 0 ? 'if' : 'else if'} (i == ${i}) { a = ${prefix}${i}; b = ${prefix}${i + 1}; }`;
  }).join('\n');
  return [
    `  vec3 q_phase${fnName}(float u) {`,
    decl,
    `    float t = fract(u) * ${segments}.0;`,
    '    int i = int(floor(t));',
    '    float f = fract(t);',
    `    vec3 a = ${prefix}0; vec3 b = ${prefix}1;`,
    chain,
    '    return mix(a, b, f);',
    '  }',
  ].join('\n');
}

export const GLSL_PHASE_COLORS = /* glsl */ `
${glslWheel('Twilight', 'tw', TWILIGHT)}

${glslWheel('Cividis', 'cv', CIVIDIS)}

  vec3 q_phaseColor(float angle, int palette) {
    float u = angle / 6.283185307179586 + 0.5;
    return palette == 1 ? q_phaseCividis(u) : q_phaseTwilight(u);
  }
`;
