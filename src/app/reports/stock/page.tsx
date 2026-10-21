import { requireUser } from '@/lib/auth';
import { slowMovers, stockByStore, stockTrend } from '@/lib/analytics/reports';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { Card, pct, ReportShell, Table } from '../report-shell';

export const dynamic = 'force-dynamic';
const day = (d: string) => formatDate(`${d}T12:00:00+05:30`);

export default async function StockPage() {
  await requireUser();
  const [{ asOf, stores, sellThrough }, trend, slow] = await Promise.all([
    stockByStore().catch(() => ({ asOf: null, stores: [], sellThrough: { sold: 0, inStock: 0, rate: null, salesFrom: null, salesThrough: null } })),
    stockTrend().catch(() => []),
    slowMovers().catch(() => []),
  ]);
  const codes = [...new Set(trend.map((t) => t.storeCode))].sort();
  const days = [...new Set(trend.map((t) => t.day))].reverse();
  const at = new Map(trend.map((t) => [`${t.day}|${t.storeCode}`, t]));

  return (
    <ReportShell title="Stock" current="/reports/stock"
      intro={`Stock from Vendor Intelligence${asOf ? `, as of ${day(asOf)}` : ''}. Aged stock = units received more than 90 days ago, at cost.`}>
      <Card title="Per store">
        <Table head={['Store', 'Units in stock', 'Stock at cost', 'Aged units', 'Aged stock at cost', 'Aged share']}
          rows={stores.map((s) => [`${s.name} (${s.storeCode})`, formatNumber(s.qty), formatCurrency(s.cost), formatNumber(s.agedQty), formatCurrency(s.agedCost), pct(s.agedQty, s.qty)])} />
        <p className="border-t border-grid px-4 py-3 text-sm text-ink-2">
          Sell-through, all stores: {sellThrough.rate === null ? '—' : `${(100 * sellThrough.rate).toFixed(1)}%`} ({formatNumber(sellThrough.sold)} units sold in the 30 days to {sellThrough.salesThrough ? day(sellThrough.salesThrough) : '—'}, {formatNumber(sellThrough.inStock)} in stock). Sales are not recorded per store, so this is company-wide.
        </p>
      </Card>
      <Card title="Aged stock at cost, day by day" note="History starts on the day the analytics database was first built.">
        <Table head={['Day', ...codes]} rows={days.map((d) => [day(d), ...codes.map((c) => { const t = at.get(`${d}|${c}`); return t ? formatCurrency(t.agedCost) : '—'; })])} />
      </Card>
      <Card title="Slow movers" note={`In stock but not sold in any store in the last 90 days, costliest first. Sales history starts ${sellThrough.salesFrom ? day(sellThrough.salesFrom) : '—'}.`}>
        <Table head={['Item', 'Store', 'Units', 'At cost', 'Last sold']}
          rows={slow.map((s) => [<span key="n">{s.item}<span className="block text-xs font-normal text-ink-muted">{s.vendor}</span></span>, s.storeCode, formatNumber(s.qty), formatCurrency(s.cost), s.lastSold ? day(s.lastSold) : 'Not in sales history'])} />
      </Card>
    </ReportShell>
  );
}
