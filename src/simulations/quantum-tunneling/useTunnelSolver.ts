'use client';

/**
 * Sim 4 — the split-step beam line, driven from the canvas' animation clock.
 *
 * Why no Web Worker here (unlike the TDSE sandbox): one Strang step at N = 1024 is
 * two radix-2 FFTs plus two O(N) phase kicks — a few tens of microseconds — and the
 * frame budget is eight of them. The worker handshake alone (cloning two
 * Float64Arrays plus message latency) costs as much as the physics, and everything
 * else this lab shows is closed form: the T(E) curve, the ⟨T⟩ folding over the
 * packet's momentum distribution, the STM feedback bisection. The Crank–Nicolson
 * sandbox *does* need a worker because it re-diagonalises H whenever V(x) is edited.
 *
 * Bookkeeping is exact rather than approximate. exp(−Δt·W/ℏ) is a positive
 * contraction, so the two sponge halves can be billed independently:
 *
 *     ‖ψ‖² + absorbedLeft + absorbedRight = ‖ψ₀‖²
 *
 * which gives a detector-like transmission that keeps counting after the transmitted
 * packet has been swallowed by the sponge,
 *
 *     T_sim = (absorbedRight + ∫_{x > x_right}|ψ|²dx) / (T_sim + R_sim denominators)
 *
 * and a unitarity residual |Δ‖ψ‖²| that stays at round-off level for hours.
 */

import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { diagnostics, type StateDiagnostics } from '@/engine/physics/crankNicolson';
import { SplitStepPropagator } from '@/engine/physics/splitStepFFT';
import type { SimParams } from '@/simulations/types';
import {
  barrierChangeSig,
  buildTunnelSetup,
  liveTunnel,
  packetSig,
  publishTunnelLive,
  TUN_ORIGIN_AU,
  type TunnelSetup,
} from './model';

export interface TunnelFrameView {
  /** Borrowed references to the runtime buffers — read-only for the renderer. */
  re: Float64Array;
  im: Float64Array;
  diag: StateDiagnostics | null;
  /** Probability the sponge has removed, split by side. */
  absorbedLeft: number;
  absorbedRight: number;
  drained: number;
  /** Detector-like fractions of the launch norm. */
  transmitted: number;
  reflected: number;
  inside: number;
  simTime: number;
  steps: number;
  computeMs: number;
  /** Frames produced since mount — lets the canvas detect a stalled solver. */
  seq: number;
}

export interface TunnelSolverState {
  setup: TunnelSetup | null;
  frame: TunnelFrameView;
  /** Change detectors. */
  barSig: string;
  packSig: string;
  dtSig: number;
  /** performance.now() of the last frame. */
  lastDelivery: number;
}

export interface TunnelSolver {
  stateRef: RefObject<TunnelSolverState>;
  /** Align the propagator with `p`, advance `steps` Strang steps, publish telemetry. */
  pump: (p: SimParams, steps: number) => void;
  /** Re-fire the packet from t = 0 without touching V(x). */
  reset: (p: SimParams) => void;
}

/** Engine held outside React: the propagator, ψ and the two sponge ledgers. */
interface Runtime {
  prop: SplitStepPropagator;
  setup: TunnelSetup;
  re: Float64Array;
  im: Float64Array;
  capL: Float64Array;
  capR: Float64Array;
  absorbedLeft: number;
  absorbedRight: number;
  simTime: number;
  steps: number;
}

const EMPTY = new Float64Array(0);

function initialState(): TunnelSolverState {
  return {
    setup: null,
    frame: {
      re: EMPTY,
      im: EMPTY,
      diag: null,
      absorbedLeft: 0,
      absorbedRight: 0,
      drained: 0,
      transmitted: 0,
      reflected: 0,
      inside: 0,
      simTime: 0,
      steps: 0,
      computeMs: 0,
      seq: 0,
    },
    barSig: '',
    packSig: '',
    dtSig: 0,
    lastDelivery: 0,
  };
}

export function useTunnelSolver(): TunnelSolver {
  const stateRef = useRef<TunnelSolverState>(initialState());
  const rtRef = useRef<Runtime | null>(null);

  /** Bill the symmetric sponge one side at a time. */
  function splitCap(setup: TunnelSetup): [Float64Array, Float64Array] {
    const half = setup.n >> 1;
    const l = new Float64Array(setup.n);
    const r = new Float64Array(setup.n);
    for (let j = 0; j < setup.n; j++) {
      if (j < half) l[j] = setup.cap[j];
      else r[j] = setup.cap[j];
    }
    return [l, r];
  }

  /** Spatial windows + absorbance ledger → this frame's measured beam split. */
  const measure = useCallback((computeMs: number): void => {
    const s = stateRef.current;
    const rt = rtRef.current;
    if (!rt) return;
    const { setup, re, im, absorbedLeft, absorbedRight } = rt;
    const n = setup.n;
    const dx = setup.dx;
    // Count a plane 1 a.u. outside the structured region on each side, which is far
    // enough that the evanescent tail is negligible but close enough to resolve the
    // two packets long before the sponge reaches them.
    const jRight = Math.min(n, Math.max(0, Math.ceil((setup.geom.right + 1 - TUN_ORIGIN_AU) / dx)));
    const jLeft = Math.min(n, Math.max(0, Math.round((setup.geom.left - 1 - TUN_ORIGIN_AU) / dx)));
    let right = 0;
    let left = 0;
    for (let j = jRight; j < n; j++) right += re[j] * re[j] + im[j] * im[j];
    for (let j = 0; j < jLeft; j++) left += re[j] * re[j] + im[j] * im[j];
    right *= dx;
    left *= dx;
    const diag = diagnostics(re, im, setup.v, dx, { hbar: 1, mass: setup.mass, origin: TUN_ORIGIN_AU });
    const transmitted = absorbedRight + right;
    const reflected = absorbedLeft + left;
    const inside = Math.max(0, diag.norm - right - left);
    s.frame = {
      re,
      im,
      diag,
      absorbedLeft,
      absorbedRight,
      drained: absorbedLeft + absorbedRight,
      transmitted,
      reflected,
      inside,
      simTime: rt.simTime,
      steps: rt.steps,
      computeMs,
      seq: s.frame.seq + 1,
    };
    s.lastDelivery = performance.now();
    publishTunnelLive(diag, setup.norm0, absorbedLeft + absorbedRight, { transmitted, reflected, inside });
    liveTunnel.resolved = inside < 0.05 * setup.norm0;
    liveTunnel.n = n;
    liveTunnel.dt = setup.dt;
  }, []);

  const advance = useCallback(
    (steps: number): void => {
      const rt = rtRef.current;
      if (!rt) return;
      const count = Math.max(0, Math.round(steps));
      const t0 = performance.now();
      for (let i = 0; i < count; i++) {
        rt.prop.step(rt.re, rt.im);
        rt.absorbedLeft += rt.prop.applyCap(rt.re, rt.im, rt.capL);
        rt.absorbedRight += rt.prop.applyCap(rt.re, rt.im, rt.capR);
        rt.simTime += rt.prop.dt;
        rt.steps += 1;
      }
      measure(performance.now() - t0);
    },
    [measure],
  );

  /**
   * (Re)build the propagator for `setup`. `keepState` carries the flying ψ across a
   * V(x) edit — dragging the barrier while the packet is en route is the single most
   * instructive interaction in this lab — while a relaunch resets clock and ledgers.
   */
  const install = useCallback(
    (setup: TunnelSetup, keepState: boolean): void => {
      const s = stateRef.current;
      const prev = rtRef.current;
      const keep = keepState && prev !== null && prev.setup.n === setup.n;
      const [capL, capR] = splitCap(setup);
      rtRef.current = {
        prop: new SplitStepPropagator({
          n: setup.n,
          dx: setup.dx,
          dt: setup.dt,
          v: setup.v,
          mass: setup.mass,
          hbar: 1,
        }),
        setup,
        re: keep && prev ? prev.re : Float64Array.from(setup.re),
        im: keep && prev ? prev.im : Float64Array.from(setup.im),
        capL,
        capR,
        absorbedLeft: keep && prev ? prev.absorbedLeft : 0,
        absorbedRight: keep && prev ? prev.absorbedRight : 0,
        simTime: keep && prev ? prev.simTime : 0,
        steps: keep && prev ? prev.steps : 0,
      };
      s.setup = setup;
      liveTunnel.maxDrift = 0;
      measure(0);
    },
    [measure],
  );

  const pump = useCallback(
    (p: SimParams, steps: number): void => {
      const s = stateRef.current;
      const bar = barrierChangeSig(p);
      const pack = packetSig(p);

      if (!s.setup || bar !== s.barSig) {
        const setup = buildTunnelSetup(p);
        s.barSig = bar;
        s.packSig = pack;
        s.dtSig = setup.dt;
        install(setup, s.setup !== null);
        advance(steps);
        return;
      }

      if (pack !== s.packSig) {
        s.packSig = pack;
        const setup = buildTunnelSetup(p);
        const rt = rtRef.current;
        if (rt && rt.setup.n === setup.n) {
          rt.setup = setup;
          rt.prop.setPotential(setup.v);
          rt.re.set(setup.re);
          rt.im.set(setup.im);
          rt.absorbedLeft = 0;
          rt.absorbedRight = 0;
          rt.simTime = 0;
          rt.steps = 0;
          s.setup = setup;
          s.dtSig = setup.dt;
        } else {
          s.setup = setup;
          s.dtSig = setup.dt;
          install(setup, false);
        }
      }

      if (s.setup.dt !== s.dtSig) {
        s.dtSig = s.setup.dt;
        install({ ...s.setup, dt: s.setup.dt }, true);
      }

      advance(steps);
    },
    [advance, install],
  );

  const reset = useCallback(
    (p: SimParams): void => {
      const s = stateRef.current;
      const setup = buildTunnelSetup(p);
      s.barSig = barrierChangeSig(p);
      s.packSig = packetSig(p);
      s.dtSig = setup.dt;
      install(setup, false);
    },
    [install],
  );

  // Stable identity: the canvas keeps `solver` in its rAF dependency list.
  return useMemo<TunnelSolver>(() => ({ stateRef, pump, reset }), [pump, reset]);
}
