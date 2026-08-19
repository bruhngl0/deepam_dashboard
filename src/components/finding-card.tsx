/**
 * Shared "finding" card idiom — eyebrow states the measure, h2 states the
 * finding. Originally defined inline on the Insights page and cross-imported
 * by Analysis; promoted here once a third consumer (the vendor dashboard)
 * needed the same idiom, so no page owns a component another page imports.
 */

/** Card wrapper. */
export function Finding({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card rounded-2xl border border-line bg-surface p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
        {eyebrow}
      </p>
      <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-ink text-balance">
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Interpretation sits below its evidence, in secondary ink. */
export function Note({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[68ch] text-sm leading-relaxed text-ink-2">{children}</p>;
}

/**
 * One measure, one hue. `scale` is the value that fills the track — 100 when the
 * quantity is genuinely a share of a whole, the row maximum when the bars are
 * only being compared with each other.
 */
export function Bar({ value, scale }: { value: number; scale: number }) {
  const pct = scale > 0 ? Math.max(0.8, Math.min(100, (100 * value) / scale)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-accent-soft/50">
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
