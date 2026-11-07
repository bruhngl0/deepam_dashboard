/**
 * Salespeople: every salesperson's sales, returns, discount, margin, customers and the walk-ins they served,
 * for the period and store in the CRM master filter. The base for incentives (rules to come).
 * Figures come from the analytics database; see lib/analytics/salesperson-module.ts for each definition.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { analyticsAsOf, analyticsConfigured } from '@/lib/analytics/db';
import { billBounds, billCoverage, salesPeriod, salespersonStats, uncreditedBills, type SalespersonStats } from '@/lib/analytics/salesperson-module';
import { formatCurrency, formatCurrencyCompact, formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { button, card, eyebrow, Kpi, KpiGrid, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const COLUMNS: { key: string; label: string; value: (r: SalespersonStats) => number | string; show: (r: SalespersonStats) => React.ReactNode }[] = [
  { key: 'bills', label: 'Bills', value: (r) => r.bills, show: (r) => formatNumber(r.bills) },
  { key: 'returns', label: 'Returns', value: (r) => r.returned, show: (r) => (r.returns ? <>{formatNumber(r.returns)} · {formatCurrencyCompact(r.returned)}</> : '—') },
  { key: 'net', label: 'Net sales', value: (r) => r.netSales, show: (r) => <span className="font-semibold text-ink">{formatCurrency(r.netSales)}</span> },
  { key: 'avg', label: 'Avg bill', value: (r) => (r.bills ? r.grossSales / r.bills : 0), show: (r) => (r.bills ? formatCurrency(r.grossSales / r.bills) : '—') },
  { key: 'qty', label: 'Items', value: (r) => r.qty, show: (r) => formatNumber(r.qty) },
  { key: 'discount', label: 'Discount', value: (r) => r.discount / (r.grossSales + r.discount || 1), show: (r) => (r.discount ? <>{formatPercent(r.discount, r.grossSales + r.discount)}<span className="block text-xs text-ink-muted">{formatCurrencyCompact(r.discount)}</span></> : '—') },
  { key: 'margin', label: 'Margin', value: (r) => (r.salesWithCost ? (r.salesWithCost - r.cost) / r.salesWithCost : 0), show: (r) => (r.salesWithCost ? formatPercent(r.salesWithCost - r.cost, r.salesWithCost) : '—') },
  { key: 'customers', label: 'Customers', value: (r) => r.customers, show: (r) => formatNumber(r.customers) },
  { key: 'matched', label: 'Bills with customer', value: (r) => (r.bills ? r.billsWithCustomer / r.bills : 0), show: (r) => (r.bills ? formatPercent(r.billsWithCustomer, r.bills, 0) : '—') },
  { key: 'new', label: 'New customers', value: (r) => r.newCustomers, show: (r) => formatNumber(r.newCustomers) },
  { key: 'repeat', label: 'Came back', value: (r) => r.repeatCustomers, show: (r) => formatNumber(r.repeatCustomers) },
  { key: 'walkins', label: 'Walk-ins served', value: (r) => r.walkIns, show: (r) => formatNumber(r.walkIns) },
  { key: 'shared', label: 'Shared walk-ins', value: (r) => r.walkInsShared, show: (r) => (r.walkIns ? <>{formatNumber(r.walkInsShared)}<span className="block text-xs text-ink-muted">{formatPercent(r.walkInsShared, r.walkIns, 0)}</span></> : '—') },
  { key: 'converted', label: 'Walk-ins converted', value: (r) => r.walkInsConverted, show: (r) => (r.walkIns ? <>{formatNumber(r.walkInsConverted)}<span className="block text-xs text-ink-muted">{formatPercent(r.walkInsConverted, r.walkIns, 0)}</span></> : '—') },
  { key: 'driver', label: 'Driver visits', value: (r) => r.driverVisits, show: (r) => (r.driverVisits ? <>{formatNumber(r.driverVisits)}<span className="block text-xs text-ink-muted">{formatNumber(r.driverBills)} billed</span></> : '—') },
  { key: 'calls', label: 'Calls', value: (r) => r.calls, show: (r) => (r.calls ? <>{formatNumber(r.calls)}<span className="block text-xs text-ink-muted">{formatNumber(r.connected)} connected</span></> : '—') },
];

function query(sp: Search, changes: Record<string, string | null>) {
  const q = new URLSearchParams();
  for (const k of ['from', 'to', 'store', 'sort', 'dir']) { const v = one(sp[k]); if (v) q.set(k, v); }
  for (const [k, v] of Object.entries(changes)) { if (v === null) q.delete(k); else q.set(k, v); }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export default async function SalespeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const period = salesPeriod(sp);

  if (!analyticsConfigured()) {
    return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Salespeople" />
      <p className={`${card} p-6 text-sm text-ink-2`}>This page reads the analytics database, which is not connected here (ANALYTICS_DATABASE_URL).</p>
    </main>;
  }

  const [rows, uncredited, coverage, bounds, asOf] = await Promise.all([salespersonStats(period), uncreditedBills(period), billCoverage(period), billBounds(), analyticsAsOf()]);
  const list = rows ?? [];
  const sortKey = COLUMNS.some((c) => c.key === one(sp.sort)) || one(sp.sort) === 'name' ? one(sp.sort)! : 'net';
  const dir = one(sp.dir) === 'asc' ? 1 : -1;
  const col = COLUMNS.find((c) => c.key === sortKey);
  const sorted = [...list].sort((a, b) => {
    if (sortKey === 'name') return dir * a.name.localeCompare(b.name);
    const x = col!.value(a), y = col!.value(b);
    return dir * (Number(x) - Number(y)) || a.name.localeCompare(b.name);
  });

  const total = list.reduce((t, r) => ({ net: t.net + r.netSales, bills: t.bills + r.bills, returns: t.returns + r.returns, returned: t.returned + r.returned }), { net: 0, bills: 0, returns: 0, returned: 0 });
  const shownFrom = period.from === '2000-01-01' ? bounds.first : period.from;
  const shownTo = bounds.last && period.to > bounds.last ? bounds.last : period.to;

  const sortLink = (key: string, label: string, align: 'left' | 'right') => {
    const active = sortKey === key;
    const nextDir = active && dir === -1 ? 'asc' : 'desc';
    return <th key={key} scope="col" className={`whitespace-nowrap px-3 py-3 font-bold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <Link href={`/crm/salespeople${query(sp, { sort: key, dir: key === 'name' && !active ? 'asc' : nextDir })}`} className={`hover:text-ink ${active ? 'text-ink' : ''}`} scroll={false}>
        {label}{active ? (dir === -1 ? ' ↓' : ' ↑') : ''}
      </Link>
    </th>;
  };

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Salespeople"
        description="What each salesperson billed, returned and served: the base for incentives. Open a name for their month-by-month figures and every bill."
        meta={<>{shownFrom && shownTo ? `Bills ${formatDate(shownFrom)} – ${formatDate(shownTo)}` : 'No bills loaded'}{period.store ? ' · one store' : ' · every store'}{asOf ? ` · data as of ${formatDateTime(asOf)}` : ''}</>}
        actions={<a href={`/crm/salespeople/export${query(sp, { sort: null, dir: null })}`} className={button}>Export CSV</a>}
      />

      <KpiGrid>
        <Kpi label="Net sales credited" value={formatCurrencyCompact(total.net)} caption={`${formatNumber(total.bills)} bills, less ${formatNumber(total.returns)} returns (${formatCurrencyCompact(total.returned)})`} />
        <Kpi label="Salespeople" value={formatNumber(list.length)} caption="With a bill, return, walk-in, driver visit or call in this period" />
        <Kpi label="Average bill" value={total.bills ? formatCurrency((total.net + total.returned) / total.bills) : '—'} caption="Credited sales bills, before returns" />
        <Kpi label="Not credited to anyone" value={uncredited ? formatNumber(uncredited.bills) : '—'}
          caption={uncredited ? <>{formatCurrency(uncredited.sales)} on bills with no salesperson{uncredited.unmatchedNames ? <> · <Link className="font-medium text-accent hover:underline" href="/reports/salespeople/match">{formatNumber(uncredited.unmatchedNames)} names to match</Link></> : ''}</> : undefined} />
      </KpiGrid>

      {coverage && coverage.bills > 0 && (
        <section className={`${card} overflow-hidden`}>
          <div className="border-b border-grid px-4 py-3"><h2 className="text-sm font-semibold text-ink">Bills in the sales sheet</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" style={{ minWidth: '36rem' }}>
              <thead><tr className={eyebrow}>{['', 'Bills', 'Share of bills', 'Value', 'Share of value'].map((h, i) =>
                <th key={i} scope="col" className={`px-4 py-3 font-bold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
              <tbody>
                {([
                  { label: 'All bills', bills: coverage.bills, note: `${formatNumber(coverage.sales)} sales + ${formatNumber(coverage.returns)} returns`, value: coverage.value, strong: true },
                  { label: 'Matched to a salesperson', bills: coverage.matchedBills, value: coverage.matchedValue },
                  ...coverage.uncredited.map((u) => ({ label: u.name ? <>Salesman written as &ldquo;{u.name}&rdquo;</> : 'No salesman name on the bill', bills: u.bills, value: u.value })),
                ] as { label: React.ReactNode; bills: number; value: number; note?: string; strong?: boolean }[]).map((r, i) => (
                  <tr key={i} className="border-t border-grid">
                    <th scope="row" className={`px-4 py-2 text-left ${r.strong ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}>{r.label}</th>
                    <td className="tnum whitespace-nowrap px-4 py-2 text-right text-ink">{formatNumber(r.bills)}{r.note && <span className="block text-xs text-ink-muted">{r.note}</span>}</td>
                    <td className="tnum whitespace-nowrap px-4 py-2 text-right text-ink-2">{r.strong ? '—' : formatPercent(r.bills, coverage.bills)}</td>
                    <td className="tnum whitespace-nowrap px-4 py-2 text-right text-ink">{formatCurrencyCompact(r.value)}</td>
                    <td className="tnum whitespace-nowrap px-4 py-2 text-right text-ink-2">{r.strong || !coverage.value ? '—' : formatPercent(r.value, coverage.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '96rem' }}>
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                {sortLink('name', 'Salesperson', 'left')}
                <th scope="col" className="px-3 py-3 text-left font-bold">Store</th>
                {COLUMNS.map((c) => sortLink(c.key, c.label, 'right'))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.empCode} className="border-t border-grid hover:bg-inset/50">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    <Link href={`/crm/salespeople/${r.empCode}${query(sp, { sort: null, dir: null })}`} className="hover:text-accent hover:underline">{r.name}</Link>
                    <span className="block text-xs font-normal text-ink-muted">{r.empCode}</span>
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-left text-ink-2">{r.storeName ?? r.storeCode ?? '—'}</td>
                  {COLUMNS.map((c) => <td key={c.key} className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{c.show(r)}</td>)}
                </tr>
              ))}
              {!sorted.length && <tr><td colSpan={COLUMNS.length + 2} className="px-3 py-8 text-center text-ink-muted">No salesperson activity in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-1 text-xs leading-relaxed text-ink-muted">
        <p><b className="text-ink-2">Bills, Returns, Net sales:</b> by the salesman printed on the bill. Returns are the negative bills; Net sales is sales less returns.</p>
        <p><b className="text-ink-2">Avg bill, Items, Discount:</b> sales bills only. Discount is the item discount as a share of the price before discount.</p>
        <p><b className="text-ink-2">Margin:</b> bill amount less the purchase value of its items, on bills where every item has a purchase value.</p>
        <p><b className="text-ink-2">Customers:</b> distinct customers billed. Bills with customer: bills matched to a customer by phone. New customers: their first bill since sales history starts (1 May 2026) was with this salesperson. Came back: bought from them on two or more days.</p>
        <p><b className="text-ink-2">Walk-ins served, Shared, Converted:</b> from WalkTrack. Walk-ins they were tagged on; a walk-in served by two people counts for each, and Shared shows how many were also tagged to someone else. Converted: marked as a sale by staff in WalkTrack. Walk-ins are not tied to bills: sales come only from the salesman named on the sales sheet.</p>
        <p><b className="text-ink-2">Driver visits:</b> RC Dashboard visits naming them. <b className="text-ink-2">Calls:</b> marketing calls logged under their name.</p>
      </section>
    </main>
  );
}
