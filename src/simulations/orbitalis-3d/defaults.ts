import type { SimParams } from '@/simulations/types';

/**
 * Orbitalis 3D — canonical state (dependency-free: statically imported by the
 * registry, so this file must never import React, three.js or shader code).
 *
 * Superpositions are stored as *parallel arrays* so the phasor matrix, the URL
 * serializer and the Demo Director tween engine all work generically:
 *   ampsN[i], ampsL[i], ampsM[i], ampsAmp[i], ampsPhase[i]
 * describe  |Ψ⟩ = Σ cᵢ|nᵢ ℓᵢ mᵢ⟩  with cᵢ = ampsAmp[i]·e^{i·ampsPhase[i]}.
 * Camera orientation is state too, so permalinks reproduce the exact viewpoint.
 */
export const orbitalisDefaults: SimParams = {
  // ── State ──────────────────────────────────────────────────────────────
  basis: 'complex', // 'complex' | 'real' | 'hybrid'
  hybrid: 'none', // 'none' | 'sp' | 'sp2' | 'sp3' | 'sp3d' | 'sp3d2'
  n: 1,
  l: 0,
  m: 0,
  Z: 1,
  ampsN: [1],
  ampsL: [0],
  ampsM: [0],
  ampsAmp: [1],
  ampsPhase: [0],

  // ── Visuals ────────────────────────────────────────────────────────────
  render: 'raymarch', // 'raymarch' | 'isosurface' | 'pointcloud' | 'slice'
  exposure: 1.1,
  gamma: 2.2,
  densityScale: 1,
  isoLevel: 0.9,
  octant: false,
  slicePlane: 'xz',
  sliceOffset: 0,
  monochrome: false,
  streamlines: false,
  showAxes: true,
  particleCount: 40000,

  // ── Fields & measurement ───────────────────────────────────────────────
  zeemanB: 0, // Tesla
  starkE: 0, // 1e9 V/m
  measure: false,
  /** Projective collapse: a measurement resets |Ψ⟩ to the eigenstate found. */
  collapse: true,
  /** Which slot the n/ℓ/m sliders edit (the phasor matrix highlights it). */
  focus: 0,
  measureRate: 240, // detections / second
  measureSeed: 0, // bump to flush the detector accumulation
  measureBurst: 0, // token: increment to fire a burst

  // ── Spectroscopy ───────────────────────────────────────────────────────
  series: 'balmer', // 'lyman' | 'balmer' | 'paschen'
  transitionHi: 3,

  // ── Camera (atomic-unit scene, distance in a₀) ─────────────────────────
  camAz: 0.62,
  camEl: 0.34,
  camDist: 32,
};

export default orbitalisDefaults;
