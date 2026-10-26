import Link from 'next/link';
import { analyticsAsOf, analyticsConfigured } from '@/lib/analytics/db';
import { formatDateTime } from '@/lib/format';

export const REPORTS = [
  { href: '/reports/funnel', label: 'Funnel' },
  { href: '/reports/salespeople', label: 'Salespeople' },
  { href: '/reports/payback', label: 'Payback' },
  { href: '/reports/cohorts', label: 'Cohorts' },
  { href: '/reports/stock', label: 'Stock' },
  { href: '/reports/salespeople/match', label: 'Salesperson matching' },
] as const;

/** Header for every report: title, the "Data as of" line, and links between the reports. */
export async function ReportShell({ title, intro, current, actions, children }: { title: string; intro: string; current: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const asOf = await analyticsAsOf().catch(() => null);
  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted"><Link href="/reports" className="hover:text-ink">Reports</Link></p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">{intro}</p>
          <p className="mt-1 text-xs text-ink-muted">{asOf ? `Data as of ${formatDateTime(asOf)} · refreshed every few minutes` : 'Data not available yet'}</p>
        </div>
        {actions}
      </header>
      <nav aria-label="Reports" className="mb-6 flex flex-wrap gap-2 text-sm">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href} aria-current={r.href === current ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${r.href === current ? 'bg-inset text-ink' : 'text-ink-2 hover:bg-inset hover:text-ink'}`}>
            {r.label}
          </Link>
        ))}
      </nav>
      {analyticsConfigured() ? children : <NotConfigured />}
    </main>
  );
}

function NotConfigured() {
  return (
    <section className="card rounded-2xl border border-line bg-surface p-6 text-sm text-ink-2">
      Reports read from the analytics database, which is not connected here yet (ANALYTICS_DATABASE_URL).
    </section>
  );
}

export function Card({ title, note, children }: { title?: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card mb-6 overflow-hidden rounded-2xl border border-line bg-surface">
      {title && (
        <div className="border-b border-grid px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {note && <p className="mt-0.5 text-xs text-ink-muted">{note}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A plain table: first column left-aligned, the rest right-aligned figures. */
export function Table({ head, rows, empty = 'Nothing to show for this period.', minWidth = '40rem' }: { head: string[]; rows: React.ReactNode[][]; empty?: string; minWidth?: string }) {
  if (!rows.length) return <p className="px-4 py-6 text-sm text-ink-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
            {head.map((h, i) => <th key={h} scope="col" className={`px-3 py-3 font-bold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-grid">
              {r.map((c, j) => j
                ? <td key={j} className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{c}</td>
                : <th key={j} scope="row" className="px-3 py-2 text-left font-medium text-ink">{c}</th>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** From/to and store picker; keeps any other query values (e.g. the funnel grouping) as hidden fields. */
export function PeriodForm({ action, from, to, stores, store, keep = {} }: {
  action: string; from: string; to: string; stores: { code: string; name: string }[]; store: string | null; keep?: Record<string, string>;
}) {
  const input = 'rounded-lg border border-line bg-surface px-3 py-2 text-ink';
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="text-ink-2" htmlFor="period-from">From</label>
      <input id="period-from" type="date" name="from" defaultValue={from} max={to} className={input} />
      <label className="text-ink-2" htmlFor="period-to">To</label>
      <input id="period-to" type="date" name="to" defaultValue={to} className={input} />
      <label className="text-ink-2" htmlFor="period-store">Store</label>
      <select id="period-store" name="store" defaultValue={store ?? ''} className={input}>
        <option value="">All stores</option>
        {stores.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
      </select>
      <button className="rounded-lg border border-line px-3 py-2 font-medium text-ink hover:bg-inset">Show</button>
    </form>
  );
}

export const pct = (part: number, whole: number) => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : '—');
