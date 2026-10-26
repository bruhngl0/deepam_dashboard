import { requireUser } from '@/lib/auth';
import { periodFrom, reportStores, slowMovers, stockByStore, stockTrend } from '@/lib/analytics/reports';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { Card, PeriodForm, pct, ReportShell, Table } from '../report-shell';

export const dynamic = 'force-dynamic';
const day = (d: string) => formatDate(`${d}T12:00:00+05:30`);

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const period = periodFrom(await searchParams, 90);
  const [{ asOf, stores, sellThrough }, trend, slow, storeList] = await Promise.all([
    stockByStore(period).catch(() => ({ asOf: null, stores: [], sellThrough: { sold: 0, inStock: 0, rate: null, salesFrom: null, salesThrough: null } })),
    stockTrend(period).catch(() => []),
    slowMovers(period).catch(() => []),
    reportStores().catch(() => []),
  ]);
  const codes = [...new Set(trend.map((t) => t.storeCode))].sort();
  const days = [...new Set(trend.map((t) => t.day))].reverse();
  const at = new Map(trend.map((t) => [`${t.day}|${t.storeCode}`, t]));

  return (
    <ReportShell title="Stock" current="/reports/stock"
      intro={`Stock from Vendor Intelligence${asOf ? `, as of ${day(asOf)}` : ''}. Aged stock = units received more than 90 days ago, at cost. Stock is the last snapshot on or before the To date; the day-by-day table covers the period.`}
      actions={<PeriodForm action="/reports/stock" from={period.from} to={period.to} stores={storeList} store={period.store} />}>
      <Card title="Per store">
        <Table head={['Store', 'Units in stock', 'Stock at cost', 'Aged units', 'Aged stock at cost', 'Aged share']}
          rows={stores.map((s) => [`${s.name} (${s.storeCode})`, formatNumber(s.qty), formatCurrency(s.cost), formatNumber(s.agedQty), formatCurrency(s.agedCost), pct(s.agedQty, s.qty)])} />
        <p className="border-t border-grid px-4 py-3 text-sm text-ink-2">
          Sell-through, all stores{period.store ? ' (not just the picked one)' : ''}: {sellThrough.rate === null ? '—' : `${(100 * sellThrough.rate).toFixed(1)}%`} ({formatNumber(sellThrough.sold)} units sold in the 30 days to {sellThrough.salesThrough ? day(sellThrough.salesThrough) : '—'}, {formatNumber(sellThrough.inStock)} in stock). Sales are not recorded per store, so this is company-wide.
        </p>
      </Card>
      <Card title="Aged stock at cost, day by day" note="Snapshots in the period. History starts on the day the analytics database was first built.">
        <Table head={['Day', ...codes]} rows={days.map((d) => [day(d), ...codes.map((c) => { const t = at.get(`${d}|${c}`); return t ? formatCurrency(t.agedCost) : '—'; })])} />
      </Card>
      <Card title="Slow movers" note={`In stock but not sold in any store in the 90 days before ${asOf ? day(asOf) : 'the snapshot'}, costliest first. Sales history starts ${sellThrough.salesFrom ? day(sellThrough.salesFrom) : '—'}.`}>
        <Table head={['Item', 'Store', 'Units', 'At cost', 'Last sold']}
          rows={slow.map((s) => [<span key="n">{s.item}<span className="block text-xs font-normal text-ink-muted">{s.vendor}</span></span>, s.storeCode, formatNumber(s.qty), formatCurrency(s.cost), s.lastSold ? day(s.lastSold) : 'Not in sales history'])} />
      </Card>
    </ReportShell>
  );
}
