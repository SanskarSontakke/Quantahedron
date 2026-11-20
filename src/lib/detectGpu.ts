/**
 * Startup GPU capability probe (§7, "WebGL2 Floating-Point Texture Support on
 * Mobile Devices"). Runs once per session, never throws, and returns the tier
 * the container uses to pick a renderer + quality budget.
 */

import type { GpuInfo } from '@/store/useSimStore';

let cached: GpuInfo | null = null;

export function detectGpu(): GpuInfo {
  if (cached) return cached;
  const info: GpuInfo = {
    webgl2: false,
    floatTextures: false,
    tier: 'low',
    renderer: 'unknown',
  };
  if (typeof window === 'undefined') return info;

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      failIfMajorPerformanceCaveat: false,
      antialias: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      cached = info;
      return info;
    }
    info.webgl2 = true;

    const extColorFloat = gl.getExtension('EXT_color_buffer_float');
    const extFloatLinear = gl.getExtension('OES_texture_float_linear');
    info.floatTextures = Boolean(extColorFloat);

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      const raw = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      if (typeof raw === 'string') info.renderer = raw.slice(0, 90);
    }

    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const maxVU = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number;
    const lowPower = /Mali-[AT]?[0-5]|Adreno \(TM\)? [1-5]|Intel\(R\) HD Graphics (4|5)/i.test(
      info.renderer,
    );

    if (info.floatTextures && maxTex >= 4096 && !lowPower) info.tier = 'high';
    else if (maxTex >= 2048 && (info.floatTextures || extFloatLinear) && !lowPower)
      info.tier = 'balanced';
    else info.tier = 'low';

    void maxVU;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    info.tier = 'low';
  }

  cached = info;
  return info;
}

/** Raymarch grid size for the hybrid lookup-texture pipeline (§5.3). */
export function bakeResolution(tier: GpuInfo['tier'], quality: 'auto' | 'high' | 'balanced' | 'low', mobile: boolean) {
  const effective = quality === 'auto' ? (tier === 'high' ? 'high' : tier === 'balanced' ? 'balanced' : 'low') : quality;
  if (effective === 'high') return mobile ? 64 : 96;
  if (effective === 'balanced') return mobile ? 48 : 72;
  return 40;
}
