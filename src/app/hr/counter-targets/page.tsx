/**
 * Counter targets: for one month, each group of counters at MG Road and Jayanagar with its sales assistants, its
 * Target 1 and Target 2 in pieces, the pieces sold and how far along it is. Rules and counting: lib/hr/counter-targets.ts.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listEmployees } from '@/lib/hr/employees';
import { resolveAssistants } from '@/lib/hr/counter-rules';
import { evaluate, MONTH, piecesByCode, previousTargetMonth, soldRows, TARGET_STORES, targetsFor, type TargetResult } from '@/lib/hr/counter-targets';
import { monthRange } from '@/lib/incentives/store';
import { todayIst } from '@/lib/queries/daily';
import { formatNumber } from '@/lib/format';
import { button, card, eyebrow, Kpi, KpiGrid, PageHeader, primaryButton, SectionLabel } from '@/components/ui';
import { copyCounterTargets } from './actions';

export const dynamic = 'force-dynamic';

const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shift = (m: string, by: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)) - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

function Status({ r }: { r: TargetResult }) {
  if (r.error) return <span className="text-xs text-red-600">{r.error}</span>;
  if (r.target2 !== null && r.sold >= r.target2) return <span className="rounded-full border border-emerald-600/30 bg-emerald-600/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Target 2 achieved</span>;
  if (r.sold >= r.target1) return <span className="rounded-full border border-emerald-600/30 bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">Target 1 achieved{r.target2 !== null ? ` · ${formatNumber(r.target2 - r.sold)} to Target 2` : ''}</span>;
  return <span className="text-xs text-ink-2">{formatNumber(r.target1 - r.sold)} to Target 1</span>;
}

function Bar({ r }: { r: TargetResult }) {
  const top = Math.max(r.target2 ?? r.target1, r.sold, 1);
  const pct = (n: number) => `${Math.min(100, (100 * n) / top)}%`;
  return (
    <div className="relative h-2 w-full min-w-28 overflow-hidden rounded-full bg-inset" aria-hidden="true">
      <div className={`h-full rounded-full ${r.sold >= r.target1 ? 'bg-emerald-600' : 'bg-accent'}`} style={{ width: pct(r.sold) }} />
      <div className="absolute inset-y-0 w-px bg-ink/50" style={{ left: pct(r.target1) }} />
      {r.target2 !== null && <div className="absolute inset-y-0 w-px bg-ink/50" style={{ left: pct(r.target2) }} />}
    </div>
  );
}

export default async function CounterTargetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const today = todayIst(), thisMonth = today.slice(0, 7);
  const month = typeof sp.month === 'string' && MONTH.test(sp.month) && sp.month <= thisMonth ? sp.month : thisMonth;
  const { from, to: end } = monthRange(month);
  const to = end > today ? today : end;

  const [targets, employees, previous, ...sold] = await Promise.all([
    targetsFor(month), listEmployees(), previousTargetMonth(month), ...TARGET_STORES.map((s) => soldRows(s.code, from, to)),
  ]);
  const stores = TARGET_STORES.map((s, i) => ({ ...s, rows: sold[i], results: evaluate(targets.filter((t) => t.storeCode === s.code), sold[i]) }));
  const all = stores.flatMap((s) => s.results);
  const hit1 = all.filter((r) => !r.error && r.sold >= r.target1).length;
  const hit2 = all.filter((r) => !r.error && r.target2 !== null && r.sold >= r.target2).length;
  const daysGone = Number(to.slice(8)), daysInMonth = Number(end.slice(8));

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Counter targets"
        description="Each month's piece targets for the counters at MG Road and Jayanagar, and what those counters have sold. A counter is the Item Short Name on the bill (03 Mysore Silk, 15 Art Printed…)."
        meta={`${label(month)}${month === thisMonth ? ` · ${daysGone} of ${daysInMonth} days` : ''} · sales up to the last import`}
        actions={<>
          <Link href={`/hr/counter-targets?month=${shift(month, -1)}`} className={button}>← {label(shift(month, -1))}</Link>
          {month < thisMonth && <Link href={`/hr/counter-targets?month=${shift(month, 1)}`} className={button}>{label(shift(month, 1))} →</Link>}
        </>}
      />

      {targets.length > 0 && (
        <KpiGrid>
          <Kpi label="Counter groups" value={formatNumber(all.length)} caption={stores.map((s) => `${s.name} ${s.results.length}`).join(' · ')} />
          <Kpi label="Target 1 achieved" value={`${formatNumber(hit1)} of ${formatNumber(all.length)}`} />
          <Kpi label="Target 2 achieved" value={`${formatNumber(hit2)} of ${formatNumber(all.filter((r) => r.target2 !== null).length)}`} />
          <Kpi label="Pieces sold on target counters" value={formatNumber(all.reduce((s, r) => s + r.sold, 0))} caption={`Against ${formatNumber(all.reduce((s, r) => s + r.target1, 0))} for Target 1`} />
        </KpiGrid>
      )}

      {!targets.length && (
        <section className={`${card} flex flex-wrap items-center justify-between gap-3 border-dashed p-5`}>
          <p className="text-sm text-ink-2"><b className="text-ink">No targets set for {label(month)}.</b> {previous ? `Start from ${label(previous)}'s targets and change what differs, or set each store's from scratch.` : 'Set each store’s targets below.'}</p>
          {previous && <form action={copyCounterTargets}><input type="hidden" name="from" value={previous} /><input type="hidden" name="to" value={month} /><button type="submit" className={primaryButton}>Copy {label(previous)}&rsquo;s targets</button></form>}
        </section>
      )}

      {stores.map((s) => (
        <section key={s.code} className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1"><SectionLabel>{s.name}</SectionLabel></div>
            <Link href={`/hr/counter-targets/edit?store=${s.code}&month=${month}`} className={button}>{s.results.length ? 'Edit targets' : 'Set targets'}</Link>
          </div>
          {s.results.length > 0 && (
            <div className={`${card} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" style={{ minWidth: '62rem' }}>
                  <thead><tr className={eyebrow}>
                    {['Counters', 'Sales assistants', 'Target 1', 'Target 2', 'Sold', 'Progress', ''].map((h, i) =>
                      <th key={i} scope="col" className={`whitespace-nowrap px-3 py-3 font-bold ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {s.results.map((r) => (
                      <tr key={r.id} className="border-t border-grid align-top hover:bg-inset/50">
                        <th scope="row" className="px-3 py-2.5 text-left font-medium text-ink">
                          {r.codes}
                          {r.byCode.length > 0 && <span className="block text-xs font-normal text-ink-muted">{r.byCode.map(([c, q]) => `${c.padStart(2, '0')}: ${formatNumber(q)}`).join(' · ')}</span>}
                        </th>
                        <td className="px-3 py-2.5 text-ink-2">
                          {resolveAssistants(r.assistants, employees).map((a, i) => <span key={i}>{i > 0 && ', '}{typeof a === 'string'
                            ? <span title="Not matched to an employee">{a}</span>
                            : <Link href={`/hr/employees/${a.employeeCode}`} className="hover:text-accent hover:underline">{a.fullName}</Link>}</span>)}
                          {!r.assistants && '—'}
                        </td>
                        <td className="tnum px-3 py-2.5 text-right text-ink-2">{formatNumber(r.target1)}</td>
                        <td className="tnum px-3 py-2.5 text-right text-ink-2">{r.target2 === null ? '—' : formatNumber(r.target2)}</td>
                        <td className="tnum px-3 py-2.5 text-right text-lg font-semibold text-ink">{formatNumber(r.sold)}</td>
                        <td className="px-3 py-3.5"><Bar r={r} /></td>
                        <td className="px-3 py-2.5"><Status r={r} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!s.results.length && targets.length > 0 && <p className="text-sm text-ink-muted">No targets set for {s.name} this month.</p>}
          <details className={`${card} px-4 py-3 text-sm`}>
            <summary className="cursor-pointer font-medium text-ink-2">Pieces sold at every {s.name} counter in {label(month)}</summary>
            {s.rows.length ? (
              <div className="mt-3 grid grid-cols-3 gap-x-6 gap-y-1 sm:grid-cols-6 lg:grid-cols-10">
                {piecesByCode(s.rows).map(([c, q]) => <div key={c} className="tnum flex justify-between gap-2"><span className="text-ink-muted">{c === '—' ? 'No code' : c.padStart(2, '0')}</span><span className="text-ink">{formatNumber(q)}</span></div>)}
              </div>
            ) : <p className="mt-2 text-ink-muted">No sales imported for this month yet.</p>}
          </details>
        </section>
      ))}

      <section className="space-y-1 text-xs leading-relaxed text-ink-muted">
        <p><b className="text-ink-2">Sold:</b> pieces sold at the store from those counters in the month, less pieces returned, from every vendor and whoever billed them. The sales assistants listed share the group&rsquo;s result. Sales count up to the latest sales import.</p>
        <p><b className="text-ink-2">Below / above:</b> by the piece&rsquo;s tag price before discount (Sales Rate). Below 5,000 is under ₹5,000; above 5,000 is ₹5,000 or more.</p>
        <p><b className="text-ink-2">Under each group:</b> the pieces from each of its counters.</p>
      </section>
    </main>
  );
}
