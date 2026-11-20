'use client';

/**
 * Synchronized Live Math & Concept Drawer (Tier 2, §2).
 *
 * Binds to the *live* store slice rather than to static copy: switch Orbitalis
 * from 1s to 3d(z²) and the rendered ψ_{nℓm}, the node census, the phase legend
 * and the challenge prompts all re-derive instantly, because each simulation
 * supplies `math(params)` and this component only formats the result.
 */

import { memo, useState } from 'react';
import { useSimStore } from '@/store/useSimStore';
import type { SimModule, SimSlug } from '@/simulations/types';
import { MathText, Tex } from '@/lib/math';
import { cx } from '@/components/ui/controls';

const TABS = ['Intuition', 'Formal Derivation', 'Interactive Challenge'] as const;

export const SyncedMathDrawer = memo(function SyncedMathDrawer({
  slug,
  module,
}: {
  slug: SimSlug;
  module: SimModule;
}) {
  const params = useSimStore((s) => s.params[slug]);
  const [open, setOpen] = useState<(typeof TABS)[number]>('Intuition');
  const content = module.math?.(params);

  if (!content) {
    return (
      <div className="glass mx-auto w-full max-w-[1440px] rounded-2xl p-5 text-[13px] text-ink-dim">
        {module.meta.name} — {module.meta.tagline}.
      </div>
    );
  }

  return (
    <section
      className="glass mx-auto w-full max-w-[1440px] rounded-2xl px-4 py-4 sm:px-6 sm:py-5"
      aria-label="Synchronized mathematics and concepts"
    >
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        {/* Reactive equations */}
        <div className="min-w-[260px] flex-1">
          <h3 className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            Live state vector
          </h3>
          <div className="mt-2 space-y-1.5" style={{ color: module.meta.accent }}>
            {content.formula.map((f, i) => (
              <div key={i} className={cx('text-ink', f.display ? 'text-[15px]' : 'text-[13px]')}>
                <Tex tex={f.tex} display={f.display} />
                {f.note ? (
                  <div className="mt-0.5 text-[11px] text-ink-faint">
                    <MathText text={f.note} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {content.readout.length ? (
            <dl className="mt-3 flex flex-wrap gap-1.5">
              {content.readout.map((r, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-hairline bg-obsidian-2/70 px-2 py-1"
                >
                  <dt className="text-[9.5px] uppercase tracking-wide text-ink-faint">{r.label}</dt>
                  <dd className="font-mono text-[12px] text-ink" data-telemetry>
                    {r.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>

        {/* Colour encoding legend */}
        <div className="min-w-[220px] flex-1">
          <h3 className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            Reading the colours
          </h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            <MathText text={content.phaseLegend} />
          </p>
          <div
            className="mt-3 h-2 w-full rounded-full"
            style={{
              background:
                'conic-gradient(from 0deg, hsl(0 85% 68%), hsl(60 85% 68%), hsl(120 85% 68%), hsl(180 85% 68%), hsl(240 85% 68%), hsl(300 85% 68%), hsl(360 85% 68%))',
              opacity: 0.75,
            }}
            aria-hidden
          />
          <div className="mt-1 flex justify-between font-mono text-[9.5px] text-ink-faint">
            <span>arg ψ = −π</span>
            <span>0</span>
            <span>+π</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 border-t border-hairline pt-3">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOpen(t)}
              aria-pressed={open === t}
              className={cx(
                'rounded-full px-2.5 py-1 text-[11px] transition-colors',
                open === t
                  ? 'bg-white/[0.08] text-ink'
                  : 'text-ink-faint hover:bg-white/5 hover:text-ink-dim',
              )}
              style={open === t ? { color: module.meta.accent } : undefined}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-3 text-[13px] leading-relaxed text-ink-dim">
          {open === 'Intuition' ? (
            <p>
              <MathText text={content.intuition} />
            </p>
          ) : null}

          {open === 'Formal Derivation' ? (
            <div className="space-y-4">
              {content.derivation.length === 0 ? (
                <p className="text-ink-faint">No derivation recorded for this simulation.</p>
              ) : null}
              {content.derivation.map((block, i) => (
                <div key={i}>
                  <h4 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                    {block.title}
                  </h4>
                  <ol className="mt-1.5 space-y-2">
                    {block.steps.map((st, j) => (
                      <li key={j} className="flex gap-2">
                        <span className="font-mono text-[10px] text-ink-faint">{j + 1}</span>
                        <span className="flex-1">
                          <MathText text={st.text} />
                          {st.math?.map((m, k) => (
                            <Tex key={k} tex={m.tex} display={m.display ?? true} className="my-1" />
                          ))}
                          {st.note ? (
                            <span className="mt-1 block border-l border-hairline pl-2 text-[10.5px] leading-relaxed text-ink-faint">
                              <MathText text={st.note} />
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ) : null}

          {open === 'Interactive Challenge' ? (
            <ul className="space-y-2.5">
              {content.challenge.map((c, i) => (
                <ChallengeRow
                  key={i}
                  {...c}
                  accent={module.meta.accent}
                  paramLabel={
                    c.paramKey
                      ? module.controls.find((ctl) => ctl.key === c.paramKey)?.label ?? c.paramKey
                      : undefined
                  }
                />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
});

function ChallengeRow({
  question,
  hint,
  answer,
  accent,
  paramKey,
  paramLabel,
}: {
  question: string;
  hint: string;
  answer: string;
  accent: string;
  paramKey?: string;
  paramLabel?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <li className="rounded-xl border border-hairline bg-obsidian-2/50 p-3">
      <p className="text-[12.5px] text-ink">
        <MathText text={question} />
      </p>
      <p className="mt-1 text-[11.5px] text-ink-faint">
        <MathText text={hint} />
      </p>
      {paramKey && paramLabel ? (
        <p className="mt-1 text-[11px] text-ink-faint">
          Hands-on — sweep{' '}
          <span className="font-mono text-ink-dim" data-param={paramKey}>
            {paramLabel}
          </span>{' '}
          in the inspector to test it.
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="mt-2 text-[11px] underline decoration-dotted underline-offset-4"
        style={{ color: accent }}
      >
        {revealed ? 'Hide answer' : 'Reveal answer'}
      </button>
      {revealed ? (
        <p className="mt-1.5 border-l-2 pl-2 text-[12px] text-ink-dim" style={{ borderColor: accent }}>
          <MathText text={answer} />
        </p>
      ) : null}
    </li>
  );
}
