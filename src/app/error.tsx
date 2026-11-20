'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Route-tree error boundary.
 *
 * Most failures a learner can hit here are renderer or chunk-loading problems on
 * a weak GPU or a stale deployment, so the boundary offers both a retry and a
 * way back to the static catalogue.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what correlates this client crash with the build/deploy log.
    console.error('Quantahedron route error:', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex flex-col gap-5 py-20">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-collapse">
        Something broke
      </p>
      <h1 className="text-[24px] font-semibold tracking-tight text-ink">
        The stage could not finish loading
      </h1>
      <p className="max-w-[64ch] text-[13px] leading-relaxed text-ink-dim">
        A simulation crashed while rendering. This is almost always a WebGL2 capability or a stale
        chunk after a redeploy — nothing you typed is lost, because the state lives in the URL.
      </p>
      {error.digest ? (
        <p className="font-mono text-[11px] text-ink-faint">reference: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="glass rounded-full px-4 py-2 text-[12.5px] text-ink transition-colors hover:border-hairline-bright"
        >
          Try again
        </button>
        <Link
          href="/"
          className="glass rounded-full px-4 py-2 text-[12.5px] text-ink-dim transition-colors hover:text-ink"
        >
          Back to the live stage
        </Link>
        <Link
          href="/#simulations"
          className="glass rounded-full px-4 py-2 text-[12.5px] text-ink-dim transition-colors hover:text-ink"
        >
          Open the library
        </Link>
      </div>
    </div>
  );
}
