/**
 * One salesperson: their figures for the period, month by month, and every bill with how the customer came in
 * (the walk-in and who served it, a marketing lead, a driver). Same definitions as /crm/salespeople.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { analyticsConfigured } from '@/lib/analytics/db';
import { BILL_PAGE_SIZE, salesPeriod, salespersonBills, salespersonMonths, salespersonProfile, salespersonStatsFor } from '@/lib/analytics/salesperson-module';
import { CHANNEL_LABEL, formatCurrency, formatCurrencyCompact, formatDate, formatNumber, formatPercent } from '@/lib/format';
import { button, card, eyebrow, Kpi, KpiGrid, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SOURCE: Record<string, string> = { pos: 'Bills', walktrack: 'WalkTrack', crm_calls: 'Calls', rc: 'RC Dashboard' };
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

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

  const [profile, stats, months, bills] = await Promise.all([
    salespersonProfile(emp), salespersonStatsFor(emp, period), salespersonMonths(emp, period), salespersonBills(emp, period, page),
  ]);
  if (!profile || !stats) notFound();
  const pages = Math.max(1, Math.ceil(bills.total / BILL_PAGE_SIZE));
  const r = stats;

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={<><Link href={`/crm/salespeople${query(sp, { page: null })}`} className="hover:text-ink">Salespeople</Link> · {profile.empCode}</>}
        title={profile.name}
        description={profile.storeName ?? profile.storeCode ?? undefined}
        meta={profile.aliases.length ? <>Also recorded as: {profile.aliases.map((a) => `${a.display} (${SOURCE[a.source] ?? a.source})`).join(' · ')}</> : undefined}
        actions={<a href={`/crm/salespeople/export${query(sp, { page: null, emp })}`} className={button}>Export bills (CSV)</a>}
      />

      <KpiGrid>
        <Kpi label="Net sales" value={formatCurrencyCompact(r.netSales)} caption={`${formatNumber(r.bills)} bills · ${formatNumber(r.returns)} returns (${formatCurrencyCompact(r.returned)})`} />
        <Kpi label="Average bill" value={r.bills ? formatCurrency(r.grossSales / r.bills) : '—'} caption={`${formatNumber(r.qty)} items sold`} />
        <Kpi label="Discount given" value={r.discount ? formatPercent(r.discount, r.grossSales + r.discount) : '—'} caption={`${formatCurrency(r.discount)} off the price`} />
        <Kpi label="Margin" value={r.salesWithCost ? formatPercent(r.salesWithCost - r.cost, r.salesWithCost) : '—'} caption={r.salesWithCost ? `${formatCurrencyCompact(r.salesWithCost - r.cost)} on ${formatCurrencyCompact(r.salesWithCost)} with known cost` : 'No purchase values'} />
        <Kpi label="Customers" value={formatNumber(r.customers)} caption={`${formatNumber(r.newCustomers)} new · ${formatNumber(r.repeatCustomers)} came back · ${r.bills ? formatPercent(r.billsWithCustomer, r.bills, 0) : '—'} of bills matched`} />
        <Kpi label="Walk-ins served" value={formatNumber(r.walkIns)} caption={r.walkIns ? `${formatNumber(r.walkInsBilled)} billed (${formatPercent(r.walkInsBilled, r.walkIns, 0)}) · ${formatCurrencyCompact(r.walkInSales)}` : 'None in WalkTrack'} />
        <Kpi label="Driver visits" value={formatNumber(r.driverVisits)} caption={r.driverVisits ? `${formatNumber(r.driverBills)} billed · ${formatCurrencyCompact(r.driverSales)}` : 'None in RC Dashboard'} />
        <Kpi label="Calls" value={formatNumber(r.calls)} caption={r.calls ? `${formatNumber(r.connected)} connected · ${formatNumber(r.interested)} interested` : 'None logged'} />
      </KpiGrid>

      <section className={`${card} overflow-hidden`}>
        <div className="border-b border-grid px-4 py-3"><h2 className="text-sm font-semibold text-ink">Month by month</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '56rem' }}>
            <thead><tr className={eyebrow}>{['Month', 'Bills', 'Returns', 'Net sales', 'Discount', 'Margin', 'Customers', 'Walk-ins served', 'Walk-ins billed'].map((h, i) =>
              <th key={h} scope="col" className={`px-3 py-3 font-bold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t border-grid">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{MONTH.format(new Date(`${m.month}-01T00:00:00Z`))}</th>
                  {[formatNumber(m.bills), m.returns ? formatNumber(m.returns) : '—', formatCurrency(m.netSales), m.discount ? formatCurrency(m.discount) : '—',
                    m.salesWithCost ? formatPercent(m.salesWithCost - m.cost, m.salesWithCost) : '—', formatNumber(m.customers), m.walkIns ? formatNumber(m.walkIns) : '—', m.walkIns ? formatNumber(m.walkInsBilled) : '—']
                    .map((v, i) => <td key={i} className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{v}</td>)}
                </tr>
              ))}
              {!months.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-muted">Nothing in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-grid px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Bills <span className="font-normal text-ink-muted">{formatNumber(bills.total)}</span></h2>
          <p className="text-xs text-ink-muted">Newest first. Returns show as negative amounts.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '72rem' }}>
            <thead><tr className={eyebrow}>{['Date', 'Bill', 'Customer', 'How they came', 'Items', 'Amount', 'Discount', 'Margin'].map((h, i) =>
              <th key={h} scope="col" className={`px-3 py-3 font-bold ${i < 4 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {bills.rows.map((b) => {
                const how = [b.servedBy && `Walk-in, served by ${b.servedBy}`, b.leadChannel && `Lead (${CHANNEL_LABEL[b.leadChannel] ?? b.leadChannel})`, b.driverCode && `Driver ${b.driverCode}`].filter(Boolean);
                return (
                  <tr key={b.billId} className="border-t border-grid align-top">
                    <td className="tnum whitespace-nowrap px-3 py-2 text-ink-2">{formatDate(b.day)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">{b.voucher?.split('@')[0] ?? '—'}<span className="block text-xs text-ink-muted">{b.storeName}</span></td>
                    <td className="px-3 py-2 text-ink">
                      {b.personId ? <Link href={`/crm/buyers/${b.personId}`} className="hover:text-accent hover:underline">{b.customerName || 'Unnamed customer'}</Link> : <span className="text-ink-muted">No customer matched</span>}
                      {b.firstBill && b.amount > 0 && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">New</span>}
                      {b.customerCode && <span className="block text-xs text-ink-muted">{b.customerCode}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-2">{how.length ? how.join(' · ') : '—'}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{formatNumber(b.qty)}</td>
                    <td className={`tnum whitespace-nowrap px-3 py-2 text-right font-medium ${b.amount < 0 ? 'text-status-critical' : 'text-ink'}`}>{formatCurrency(b.amount)}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{b.discount ? formatCurrency(b.discount) : '—'}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{b.cost !== null && b.amount > 0 ? formatPercent(b.amount - b.cost, b.amount) : '—'}</td>
                  </tr>
                );
              })}
              {!bills.rows.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-muted">No bills in this period.</td></tr>}
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
