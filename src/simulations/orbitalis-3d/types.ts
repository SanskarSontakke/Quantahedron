/**
 * Orbitalis 3D — shared internal types (kept out of bake.ts so the sampler and
 * the renderer can both depend on them without cycles).
 */

export interface BakeData {
  /** RGBA pixel payload: Uint16Array (HALF_FLOAT) or Uint8Array (packed 16-bit). */
  gpu: Uint8Array | Uint16Array;
  res: number;
  packed: boolean;
  /** Decimated complex grid used by the CPU samplers. */
  cpuRe: Float32Array;
  cpuIm: Float32Array;
  cpuRes: number;
  rBox: number;
  /** Measured peak |ψ| of the normalised data (≤ 1). */
  peak: number;
}

export type BakeProgress = (fraction: number) => void;

export type RenderMode = 'raymarch' | 'isosurface' | 'slice' | 'pointcloud';
export type SliceAxis = 'xy' | 'xz' | 'yz';

export interface FrameState {
  mode: RenderMode;
  camAz: number;
  camEl: number;
  camDist: number;
  count: number;
  /** Display frequencies (atomic units) — already field-corrected. */
  omega: number[];
  amps: number[];
  phases: number[];
  rBox: number;
  exposure: number;
  gamma: number;
  isoLevel: number;
  /** Combined density gain (auto-exposure × user density scale). */
  density: number;
  octant: boolean;
  sliceAxis: SliceAxis;
  sliceOffset: number;
  monochrome: boolean;
  showAxes: boolean;
  /** 0 = twilight, 1 = cividis. */
  palette: number;
  /** Simulation time in atomic units. */
  time: number;
}
