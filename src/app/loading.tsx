export default function Loading() {
  return (
    <div className="flex flex-col gap-5 py-10" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="h-3 w-40 animate-pulse rounded-full bg-glass" />
      <div className="h-7 w-2/3 animate-pulse rounded-full bg-glass" />
      <div className="stage-frame flex h-[52vh] min-h-[340px] w-full items-center justify-center">
        <span className="flex items-center gap-3 text-[12px] text-ink-dim">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-transparent border-t-plasma" />
          Preparing the stage…
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass h-36 animate-pulse rounded-[var(--radius-stage)]" />
        ))}
      </div>
    </div>
  );
}
