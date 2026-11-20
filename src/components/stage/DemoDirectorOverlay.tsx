'use client';

/**
 * Auto-Demonstration overlay (§3.4).
 *
 * Runs the declarative timeline from `engine/demos/director.ts`, painting a
 * subtitle plus a scrubbable chapter bar on the stage, and yields the moment the
 * learner grabs the viewport or a slider — with a one-click Resume Tour pill.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/useSimStore';
import type { SimModule, SimSlug } from '@/simulations/types';
import { sampleDemo } from '@/engine/demos/director';
import { cx } from '@/components/ui/controls';

/** ~30 Hz param writes: smooth tours without React churn at 60 Hz. */
const TICK_MS = 33;

export const DemoDirectorOverlay = memo(function DemoDirectorOverlay({
  slug,
  module,
}: {
  slug: SimSlug;
  module: SimModule;
}) {
  const demo = useSimStore((s) => s.demo);
  const setDemoTime = useSimStore((s) => s.setDemoTime);
  const stopDemo = useSimStore((s) => s.stopDemo);
  const setParams = useSimStore((s) => s.setParams);
  const [showMenu, setShowMenu] = useState(false);
  const raf = useRef<number | null>(null);
  const lastTick = useRef(0);
  const playing = demo.playing && !demo.interrupted;

  const script = module.demos?.find((d) => d.id === demo.scriptId) ?? null;

  // Tour clock.
  useEffect(() => {
    if (!script || !playing) {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      return;
    }
    const loop = (now: number) => {
      raf.current = requestAnimationFrame(loop);
      if (now - lastTick.current < TICK_MS) return;
      const dt = lastTick.current ? Math.min(0.25, (now - lastTick.current) / 1000) : 0;
      lastTick.current = now;
      const state = useSimStore.getState();
      const t = state.demo.t + dt;
      if (t >= script.durationSec) {
        const sample = sampleDemo(script, script.durationSec, state.params[slug] ?? {});
        setParams(slug, sample.patch);
        setDemoTime(script.durationSec, sample.caption);
        useSimStore.setState((s) => ({ demo: { ...s.demo, playing: false } }));
        return;
      }
      const sample = sampleDemo(script, t, state.params[slug] ?? {});
      if (Object.keys(sample.patch).length) setParams(slug, sample.patch);
      setDemoTime(t, sample.caption);
    };
    lastTick.current = 0;
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [script, playing, slug, setParams, setDemoTime]);

  const scrub = useCallback(
    (t: number) => {
      if (!script) return;
      const state = useSimStore.getState();
      const sample = sampleDemo(script, t, state.params[slug] ?? {});
      setParams(slug, sample.patch);
      setDemoTime(t, sample.caption);
    },
    [script, slug, setParams, setDemoTime],
  );

  if (!module.demos || module.demos.length === 0) return null;

  return (
    <>
      {/* Subtitle */}
      {script && demo.scriptId ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[54px] z-20 flex justify-center px-4">
          <p
            className={cx(
              'glass max-w-[720px] rounded-xl px-3.5 py-2 text-center text-[12.5px] leading-snug text-ink',
              demo.interrupted && 'opacity-50',
            )}
          >
            {demo.caption ?? script.label}
          </p>
        </div>
      ) : null}

      {/* Timeline / menu bar */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-hairline bg-gradient-to-t from-abyss/90 to-transparent px-3 py-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMenu((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border border-hairline bg-obsidian-2/80 px-2.5 py-1 text-[11px] text-ink-dim hover:text-ink"
            aria-expanded={showMenu}
          >
            <span style={{ color: module.meta.accent }}>▶</span>
            {script ? script.label : 'Guided tours'}
          </button>
          {showMenu ? (
            <div className="glass absolute bottom-[calc(100%+8px)] left-0 z-30 w-[280px] rounded-xl p-1.5 shadow-lift">
              {module.demos.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    useSimStore.getState().startDemo(d.id);
                    setShowMenu(false);
                  }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                >
                  <div className="text-[12px] text-ink">{d.label}</div>
                  <div className="text-[10.5px] leading-snug text-ink-faint">{d.summary}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {script ? (
          <>
            <input
              type="range"
              min={0}
              max={script.durationSec}
              step={0.05}
              value={demo.t}
              onChange={(e) => scrub(Number(e.target.value))}
              className="q-range h-4 flex-1"
              aria-label="Tour timeline"
              style={{ ['--q-accent' as string]: module.meta.accent }}
            />
            <span className="font-mono text-[10px] text-ink-faint" data-telemetry>
              {demo.t.toFixed(1)}s / {script.durationSec.toFixed(0)}s
            </span>
            {demo.interrupted ? (
              <button
                type="button"
                onClick={() => useSimStore.getState().resumeDemo()}
                className="rounded-full border border-plasma/40 px-2 py-0.5 text-[10.5px] text-plasma"
              >
                Resume tour
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  useSimStore.setState((s) => ({ demo: { ...s.demo, playing: !s.demo.playing } }))
                }
                className="rounded-full border border-hairline px-2 py-0.5 text-[10.5px] text-ink-dim hover:text-ink"
              >
                {playing ? 'Pause' : 'Play'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                stopDemo();
                setShowMenu(false);
              }}
              className="rounded-full border border-hairline px-2 py-0.5 text-[10.5px] text-ink-dim hover:text-collapse"
              title="Exit guided tour"
            >
              Exit
            </button>
          </>
        ) : (
          <span className="text-[10.5px] text-ink-faint">
            Pick a tour — the stage drives itself; touch anything to take over.
          </span>
        )}
      </div>
    </>
  );
});
