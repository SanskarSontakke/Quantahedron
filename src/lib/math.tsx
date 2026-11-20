'use client';

/**
 * KaTeX rendering helpers.
 *
 * KaTeX runs entirely locally (no CDN fonts, no server) which keeps the maths
 * typographic and avoids the layout shift the PRD calls out. `MathInline`
 * additionally parses `$...$` spans inside prose so the concept drawer can mix
 * sentences and equations naturally.
 */

import { memo, useMemo } from 'react';
import katex from 'katex';

export function renderTex(tex: string, display = false): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      output: 'html',
      trust: false,
    });
  } catch {
    return `<code>${tex.replace(/[<>&]/g, '')}</code>`;
  }
}

export const Tex = memo(function Tex({
  tex,
  display = false,
  className = '',
}: {
  tex: string;
  display?: boolean;
  className?: string;
}) {
  const html = useMemo(() => renderTex(tex, display), [tex, display]);
  if (display) {
    return (
      <div
        className={`overflow-x-auto py-1 text-ink ${className}`}
        dangerouslySetInnerHTML={{ __html: `<div class="katex-display">${html}</div>` }}
      />
    );
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Prose with inline `$...$` TeX. `$$...$$` becomes a display block. */
export const MathText = memo(function MathText({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  const parts = useMemo(() => splitMath(text), [text]);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.value}</span>
        ) : (
          <Tex key={i} tex={part.value} display={part.display} />
        ),
      )}
    </span>
  );
});

type Piece = { type: 'text'; value: string } | { type: 'math'; value: string; display: boolean };

function splitMath(src: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < src.length) {
    const dollar = src.indexOf('$', i);
    if (dollar < 0) {
      out.push({ type: 'text', value: src.slice(i) });
      break;
    }
    if (dollar > i) out.push({ type: 'text', value: src.slice(i, dollar) });
    const display = src[dollar + 1] === '$';
    const close = src.indexOf(display ? '$$' : '$', dollar + (display ? 2 : 1));
    if (close < 0) {
      out.push({ type: 'text', value: src.slice(dollar) });
      break;
    }
    out.push({
      type: 'math',
      value: src.slice(dollar + (display ? 2 : 1), close),
      display,
    });
    i = close + (display ? 2 : 1);
  }
  return out.filter((p) => p.value !== '');
}
