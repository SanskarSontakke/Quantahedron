'use client';

/**
 * Shared simulation clock.
 *
 * One rAF loop drives every simulation: it honours the global play/pause and
 * time-scale, yields to prefers-reduced-motion, auto-pauses when the tab or the
 * stage is hidden, and reports dt clamped so a backgrounded tab never fast-forwards
 * a PDE by ten seconds in one step.
 */

import { useEffect, useRef } from 'react';
import { useSimStore } from '@/store/useSimStore';

export interface ClockInfo {
  /** Seconds since the previous tick, already multiplied by timeScale. */
  dt: number;
  /** Wall-clock seconds since mount (never scaled). */
  elapsed: number;
  /** Monotonic accumulated simulation time. */
  t: number;
  frame: number;
}

export function useAnimationClock(
  callback: (info: ClockInfo) => void,
  options: { maxDt?: number; active?: boolean } = {},
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const maxDt = options.maxDt ?? 0.05;
  const active = options.active ?? true;

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let frame = 0;
    const start = last;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const store = useSimStore.getState();
      const rawDt = Math.min(maxDt, (now - last) / 1000);
      last = now;
      frame += 1;
      const dt = store.playing && !store.prefs.reducedMotion ? rawDt * store.timeScale : 0;
      t += dt;
      if (store.playing) store.setSimTime(store.simTime + dt);
      cbRef.current({ dt, elapsed: (now - start) / 1000, t, frame });
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, maxDt]);
}

/** FPS sampler used by the stage's dynamic-resolution scaler. */
export function useFpsProbe(onSample: (fps: number) => void, windowMs = 800): void {
  const ref = useRef(onSample);
  ref.current = onSample;
  useEffect(() => {
    let frames = 0;
    let raf = 0;
    let start = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      frames += 1;
      if (now - start >= windowMs) {
        ref.current((frames * 1000) / (now - start));
        frames = 0;
        start = now;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [windowMs]);
}
