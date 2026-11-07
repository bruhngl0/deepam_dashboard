/**
 * Shared look for every module: page header, KPI tile, filter row, buttons and inputs.
 *
 * One compact style across CRM, Reports, Vendor, Marketing and the calling desks, so a page in one
 * module reads like a page in any other. Use these instead of writing the classes out again.
 */

import type { ReactNode } from 'react';

/** Selects, date and text inputs. Add `w-full` where a control should fill its column (forms). */
export const control =
  'rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink transition-shadow focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50';

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-40';
export const button = `${buttonBase} border-line bg-surface text-ink shadow-sm hover:bg-inset`;
export const primaryButton = `${buttonBase} border-accent bg-accent text-white shadow-sm hover:bg-accent-strong`;
/** Quiet text action, e.g. "Clear filters". */
export const textButton =
  'rounded-xl px-3 py-2 text-sm font-medium text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40';

export const card = 'card rounded-2xl border border-line bg-surface';
/** Small uppercase label: page eyebrows, KPI labels, section labels. */
export const eyebrow = 'text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted';

export function PageHeader({ eyebrow: kicker, title, description, meta, actions }: {
  eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; meta?: ReactNode; actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker && <p className={eyebrow}>{kicker}</p>}
        <h1 className={`${kicker ? 'mt-1 ' : ''}text-2xl font-semibold tracking-tight text-ink`}>{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p>}
        {meta && <p className="tnum mt-1 text-xs text-ink-muted">{meta}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A labelled rule that starts a group of content on a page. */
export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 id={id} className={eyebrow}>{children}</h2>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

/** One headline number. Pass `onClick` or `href` to make the tile open what it counts. */
export function Kpi({ label, value, caption, onClick, href }: {
  label: ReactNode; value: ReactNode; caption?: ReactNode; onClick?: () => void; href?: string;
}) {
  const body = <>
    <p className={eyebrow}>{label}</p>
    <p className="tnum mt-2 text-3xl font-semibold leading-none tracking-tight text-ink">{value}</p>
    {caption && <p className="mt-2 text-sm text-ink-2">{caption}</p>}
  </>;
  const cls = `${card} flex flex-col px-5 py-4 text-left`;
  if (href) return <a href={href} className={`${cls} card-interactive transition-colors hover:border-accent`}>{body}</a>;
  if (onClick) return <button type="button" onClick={onClick} className={`${cls} card-interactive transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

export function KpiGrid({ children, columns = 4 }: { children: ReactNode; columns?: 2 | 3 | 4 | 5 }) {
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-4', 5: 'sm:grid-cols-2 lg:grid-cols-5' }[columns];
  return <div className={`grid gap-3 ${cols}`}>{children}</div>;
}

/** The filter strip: controls in one wrapping row, with an optional note on its own line. */
export function FilterRow({ children, note, label = 'Filters', pending = false }: {
  children: ReactNode; note?: ReactNode; label?: string; pending?: boolean;
}) {
  return (
    <section aria-label={label} className={`flex flex-wrap items-center gap-2 ${pending ? 'opacity-70' : ''}`}>
      <span className="text-xs font-medium text-ink-muted">Filter</span>
      {children}
      {note && <p className="w-full text-xs text-ink-muted">{note}</p>}
    </section>
  );
}

/** A control with a small label beside it, for use inside FilterRow. */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex items-center gap-1.5 text-xs text-ink-muted">{label}{children}</label>;
}

/** From / To date pair, as in the CRM's master filter. */
export function DateRange({ from, to, setFrom, setTo, min, max }: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; min?: string; max?: string;
}) {
  return <>
    <FilterField label="From"><input type="date" className={control} value={from} min={min} max={to || max} onChange={e => setFrom(e.target.value)} /></FilterField>
    <FilterField label="To"><input type="date" className={control} value={to} min={from || min} max={max} onChange={e => setTo(e.target.value)} /></FilterField>
  </>;
}
