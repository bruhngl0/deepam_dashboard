/**
 * One salesperson: their figures for the period, month by month, and every bill under their name on the sales sheet.
 * Same definitions as /crm/salespeople.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { analyticsConfigured } from '@/lib/analytics/db';
import { BILL_PAGE_SIZE, billBounds, salesPeriod, salespersonBills, salespersonMonths, salespersonProfile, salespersonStatsFor, type MonthRow } from '@/lib/analytics/salesperson-module';
import { billOnlyPhoneLabel } from '@/lib/phone';
import { formatCurrency, formatCurrencyCompact, formatDate, formatNumber, formatPercent } from '@/lib/format';
import { button, card, eyebrow, Kpi, KpiGrid, PageHeader, SectionLabel } from '@/components/ui';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SOURCE: Record<string, string> = { pos: 'Bills', walktrack: 'WalkTrack', crm_calls: 'Calls', rc: 'RC Dashboard' };
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthName = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`));
const dash = (v: number, f: (v: number) => string) => (v ? f(v) : '—');

type SalesFigures = Pick<MonthRow, 'bills' | 'grossSales' | 'returns' | 'returned' | 'netSales' | 'discount' | 'salesWithCost' | 'cost' | 'customers'>;
/** Bills, Sold, Returns, Returned, Net sales, Average bill, Discount, Margin, Customers. */
const salesCells = (m: SalesFigures) => [
  formatNumber(m.bills), formatCurrency(m.grossSales), dash(m.returns, formatNumber), dash(m.returned, formatCurrency), formatCurrency(m.netSales),
  m.bills ? formatCurrency(m.grossSales / m.bills) : '—', dash(m.discount, formatCurrency),
  m.salesWithCost ? formatPercent(m.salesWithCost - m.cost, m.salesWithCost) : '—', formatNumber(m.customers),
];
type WalkFigures = Pick<MonthRow, 'walkIns' | 'walkInsShared' | 'walkInsConverted'>;
/** Served, Alone, Shared, Marked converted, Not marked converted, Converted %. */
const walkCells = (m: WalkFigures) => [
  formatNumber(m.walkIns), formatNumber(m.walkIns - m.walkInsShared), formatNumber(m.walkInsShared),
  formatNumber(m.walkInsConverted), formatNumber(m.walkIns - m.walkInsConverted), formatPercent(m.walkInsConverted, m.walkIns, 0),
];

function query(sp: Search, changes: Record<string, string | null>) {
  const q = new URLSearchParams();
  for (const k of ['from', 'to', 'store', 'page']) { const v = one(sp[k]); if (v) q.set(k, v); }
  for (const [k, v] of Object.entries(changes)) { if (v === null) q.delete(k); else q.set(k, v); }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export default async function SalespersonPage({ params, searchParams }: { params: Promise<{ emp: string }>; searchParams: Promise<Search> }) {
  await requireUser();
  const [{ emp }, sp] = await Promise.all([params, searchParams]);
  if (!/^EMP-\d{4}$/.test(emp) || !analyticsConfigured()) notFound();
  const period = salesPeriod(sp);
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const [profile, stats, months, bills, bounds] = await Promise.all([
    salespersonProfile(emp), salespersonStatsFor(emp, period), salespersonMonths(emp, period), salespersonBills(emp, period, page), billBounds(),
  ]);
  if (!profile || !stats) notFound();
  const pages = Math.max(1, Math.ceil(bills.total / BILL_PAGE_SIZE));
  const r = stats;
  const lastBillMonth = bounds.last?.slice(0, 7) ?? '';
  // Sales rows: months with bills, plus months after the last imported bill (shown as not imported yet).
  const salesMonths = months.filter((m) => m.bills || m.returns || (lastBillMonth && m.month > lastBillMonth));
  const walkMonths = months.filter((m) => m.walkIns);

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={<><Link href={`/crm/salespeople${query(sp, { page: null })}`} className="hover:text-ink">Salespeople</Link> · {profile.empCode}</>}
        title={profile.name}
        description={profile.storeName ?? profile.storeCode ?? undefined}
        meta={profile.aliases.length ? <>Also recorded as: {profile.aliases.map((a) => `${a.display} (${SOURCE[a.source] ?? a.source})`).join(' · ')}</> : undefined}
        actions={<a href={`/crm/salespeople/export${query(sp, { page: null, emp })}`} className={button}>Export bills (CSV)</a>}
      />

      <SectionLabel>Sales · from the sales sheet</SectionLabel>
      <KpiGrid columns={3}>
        <Kpi label="Net sales" value={formatCurrencyCompact(r.netSales)} caption={`${formatCurrencyCompact(r.grossSales)} sold − ${formatCurrencyCompact(r.returned)} returned`} />
        <Kpi label="Bills" value={formatNumber(r.bills)} caption={r.returns ? `plus ${formatNumber(r.returns)} returns` : 'No returns'} />
        <Kpi label="Average bill" value={r.bills ? formatCurrency(r.grossSales / r.bills) : '—'} caption={`${formatNumber(r.qty)} items sold`} />
        <Kpi label="Discount given" value={r.discount ? formatPercent(r.discount, r.grossSales + r.discount) : '—'} caption={`${formatCurrency(r.discount)} off the price`} />
        <Kpi label="Margin" value={r.salesWithCost ? formatPercent(r.salesWithCost - r.cost, r.salesWithCost) : '—'} caption={r.salesWithCost ? `${formatCurrencyCompact(r.salesWithCost - r.cost)} on ${formatCurrencyCompact(r.salesWithCost)} with known cost` : 'No purchase values'} />
        <Kpi label="Customers" value={formatNumber(r.customers)} caption={`${formatNumber(r.newCustomers)} new · ${formatNumber(r.repeatCustomers)} came back`} />
      </KpiGrid>

      <SectionLabel>Walk-ins and other activity · from WalkTrack, RC Dashboard and calls</SectionLabel>
      <KpiGrid>
        <Kpi label="Walk-ins served" value={formatNumber(r.walkIns)} caption={r.walkIns ? `${formatNumber(r.walkIns - r.walkInsShared)} alone · ${formatNumber(r.walkInsShared)} shared with a colleague` : 'None in WalkTrack'} />
        <Kpi label="Marked converted" value={formatNumber(r.walkInsConverted)} caption={r.walkIns ? `${formatPercent(r.walkInsConverted, r.walkIns, 0)} of walk-ins served, ticked by staff` : 'None in WalkTrack'} />
        <Kpi label="Driver visits" value={formatNumber(r.driverVisits)} caption={r.driverVisits ? `${formatNumber(r.driverBills)} billed · ${formatCurrencyCompact(r.driverSales)}` : 'None in RC Dashboard'} />
        <Kpi label="Calls" value={formatNumber(r.calls)} caption={r.calls ? `${formatNumber(r.connected)} connected · ${formatNumber(r.interested)} interested` : 'None logged'} />
      </KpiGrid>

      <SectionLabel>Month by month</SectionLabel>

      <section className={`${card} overflow-hidden`}>
        <div className="border-b border-grid px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Sales <span className="font-normal text-ink-muted">· from the sales sheet, by the salesman named on each bill</span></h2>
          <p className="mt-1 text-xs text-ink-muted">Net sales = Sold − Returned. Average bill and discount are on sales bills only. Customers in the total counts each customer once, even if they bought in several months.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '62rem' }}>
            <thead><tr className={eyebrow}>{['Month', 'Bills', 'Sold', 'Returns', 'Returned', 'Net sales', 'Average bill', 'Discount', 'Margin', 'Customers'].map((h, i) =>
              <th key={h} scope="col" className={`px-3 py-3 font-bold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {salesMonths.map((m) => {
                const notLoaded = !m.bills && !m.returns && bounds.last !== null && `${m.month}-01` > bounds.last;
                return (
                  <tr key={m.month} className="border-t border-grid">
                    <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{monthName(m.month)}</th>
                    {notLoaded
                      ? <td colSpan={9} className="px-3 py-2 text-left text-ink-muted">Sales sheet not imported yet for this month</td>
                      : salesCells(m).map((v, i) => <td key={i} className={`tnum whitespace-nowrap px-3 py-2 text-right ${i === 4 ? 'font-semibold text-ink' : 'text-ink-2'}`}>{v}</td>)}
                  </tr>
                );
              })}
              {!salesMonths.length && <tr><td colSpan={10} className="px-3 py-6 text-center text-ink-muted">No bills in this period.</td></tr>}
            </tbody>
            {salesMonths.length > 1 && (
              <tfoot><tr className="border-t-2 border-line bg-inset/50">
                <th scope="row" className="px-3 py-2 text-left font-semibold text-ink">Total</th>
                {salesCells(r).map((v, i) => <td key={i} className="tnum whitespace-nowrap px-3 py-2 text-right font-semibold text-ink">{v}</td>)}
              </tr></tfoot>
            )}
          </table>
        </div>
      </section>

      <section className={`${card} overflow-hidden`}>
        <div className="border-b border-grid px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Walk-ins <span className="font-normal text-ink-muted">· from WalkTrack, as staff logged them</span></h2>
          <p className="mt-1 text-xs text-ink-muted">Served = Alone + Shared. Served = Marked converted + Not marked converted. A shared walk-in counts in full for each salesperson on it.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '52rem' }}>
            <thead><tr className={eyebrow}>{['Month', 'Walk-ins served', 'Alone', 'Shared with a colleague', 'Marked converted', 'Not marked converted', 'Converted %'].map((h, i) =>
              <th key={h} scope="col" className={`px-3 py-3 font-bold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {walkMonths.map((m) => (
                <tr key={m.month} className="border-t border-grid">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{monthName(m.month)}</th>
                  {walkCells(m).map((v, i) => <td key={i} className={`tnum whitespace-nowrap px-3 py-2 text-right ${i === 0 ? 'font-semibold text-ink' : 'text-ink-2'}`}>{v}</td>)}
                </tr>
              ))}
              {!walkMonths.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">No walk-ins logged for this salesperson in this period.</td></tr>}
            </tbody>
            {walkMonths.length > 1 && (
              <tfoot><tr className="border-t-2 border-line bg-inset/50">
                <th scope="row" className="px-3 py-2 text-left font-semibold text-ink">Total</th>
                {walkCells(r).map((v, i) => <td key={i} className="tnum whitespace-nowrap px-3 py-2 text-right font-semibold text-ink">{v}</td>)}
              </tr></tfoot>
            )}
          </table>
        </div>
        <p className="border-t border-grid px-4 py-3 text-xs leading-relaxed text-ink-muted">
          <b className="text-ink-2">Why Marked converted and Bills differ:</b> they are separate records and are not matched to each other. A walk-in
          can be ticked converted but billed under a colleague&apos;s name or on a later day; a bill can come from a customer who was not logged in
          WalkTrack. For sales and incentives, use the Sales table: it comes from the bills.
        </p>
      </section>

      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-grid px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Bills <span className="font-normal text-ink-muted">{formatNumber(bills.total)}</span></h2>
          <p className="text-xs text-ink-muted">Newest first. Returns show as negative amounts.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '60rem' }}>
            <thead><tr className={eyebrow}>{['Date', 'Bill', 'Customer', 'Items', 'Amount', 'Discount', 'Margin'].map((h, i) =>
              <th key={h} scope="col" className={`px-3 py-3 font-bold ${i < 3 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {bills.rows.map((b) => {
                return (
                  <tr key={b.billId} className="border-t border-grid align-top">
                    <td className="tnum whitespace-nowrap px-3 py-2 text-ink-2">{formatDate(b.day)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">{b.voucher?.split('@')[0] ?? '—'}<span className="block text-xs text-ink-muted">{b.storeName}</span></td>
                    <td className="px-3 py-2 text-ink">
                      {b.personId ? <Link href={`/crm/buyers/${b.personId}`} className="hover:text-accent hover:underline">{b.customerName || 'No name on bill'}</Link> : <span className="text-ink-muted">Staff or store account (not a customer)</span>}
                      {b.firstBill && b.amount > 0 && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">New</span>}
                      {(b.customerCode || billOnlyPhoneLabel(b.customerPhone)) && <span className="block text-xs text-ink-muted">{[b.customerCode, billOnlyPhoneLabel(b.customerPhone)].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{formatNumber(b.qty)}</td>
                    <td className={`tnum whitespace-nowrap px-3 py-2 text-right font-medium ${b.amount < 0 ? 'text-status-critical' : 'text-ink'}`}>{formatCurrency(b.amount)}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{b.discount ? formatCurrency(b.discount) : '—'}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{b.cost !== null && b.amount > 0 ? formatPercent(b.amount - b.cost, b.amount) : '—'}</td>
                  </tr>
                );
              })}
              {!bills.rows.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">No bills in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-grid px-4 py-3 text-sm text-ink-2">
            <span className="tnum">{formatNumber((page - 1) * BILL_PAGE_SIZE + 1)}–{formatNumber(Math.min(page * BILL_PAGE_SIZE, bills.total))} of {formatNumber(bills.total)}</span>
            <div className="flex items-center gap-2">
              {page > 1 ? <Link className={button} href={`/crm/salespeople/${emp}${query(sp, { page: String(page - 1) })}`} scroll={false}>Previous</Link> : <span className={`${button} opacity-40`}>Previous</span>}
              <span className="tnum">Page {page} of {pages}</span>
              {page < pages ? <Link className={button} href={`/crm/salespeople/${emp}${query(sp, { page: String(page + 1) })}`} scroll={false}>Next</Link> : <span className={`${button} opacity-40`}>Next</span>}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
