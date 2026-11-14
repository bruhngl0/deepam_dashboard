import { analyticsAsOf, analyticsConfigured } from '@/lib/analytics/db';
import { formatDateTime } from '@/lib/format';

/** Header for an HR Intelligence page that reads the analytics database: title and the "Data as of" line. */
export async function HrShell({ title, intro, actions, children }: { title: string; intro: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const asOf = await analyticsAsOf().catch(() => null);
  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">HR Intelligence</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">{intro}</p>
          <p className="mt-1 text-xs text-ink-muted">{asOf ? `Data as of ${formatDateTime(asOf)} · refreshed every few minutes` : 'Data not available yet'}</p>
        </div>
        {actions}
      </header>
      {analyticsConfigured() ? children : (
        <section className="card rounded-2xl border border-line bg-surface p-6 text-sm text-ink-2">
          This page reads the analytics database, which is not connected here yet (ANALYTICS_DATABASE_URL).
        </section>
      )}
    </main>
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
export function Table({ head, rows, empty = 'Nothing to show.', minWidth = '40rem' }: { head: string[]; rows: React.ReactNode[][]; empty?: string; minWidth?: string }) {
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
