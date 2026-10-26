import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { periodFrom, reportStores, salespeople, unattributed } from '@/lib/analytics/reports';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Card, PeriodForm, pct, ReportShell, Table } from '../report-shell';

export const dynamic = 'force-dynamic';

export default async function SalespeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const period = periodFrom(await searchParams);
  const [rows, missing, stores] = await Promise.all([salespeople(period).catch(() => []), unattributed(period).catch(() => null), reportStores().catch(() => [])]);

  return (
    <ReportShell title="Salespeople" current="/reports/salespeople"
      intro="One row per Salesperson ID, adding up their WalkTrack walk-ins, bills and marketing calls. A walk-in served by two people counts for each. Picking a store shows that store's salespeople; unmatched calls are not recorded per store."
      actions={<PeriodForm action="/reports/salespeople" from={period.from} to={period.to} stores={stores} store={period.store} />}>
      {missing && (missing.bills > 0 || missing.calls > 0) && (
        <p className="mb-4 text-sm text-ink-2">
          Not credited to anyone yet: {formatNumber(missing.bills)} bills ({formatCurrency(missing.sales)}) and {formatNumber(missing.calls)} calls in this period, from {formatNumber(missing.unmatchedNames)} names not matched.{' '}
          <Link href="/reports/salespeople/match" className="font-medium text-ink underline">Match them</Link>
        </p>
      )}
      <Card>
        <Table head={['Salesperson', 'Store', 'Walk-ins', 'Converted', 'Conversion rate', 'Bills', 'Total sales', 'Average bill value', 'Calls', 'Connected']}
          rows={rows.map((r) => [
            <span key="n">{r.name}<span className="block text-xs font-normal text-ink-muted">{r.empCode}</span></span>,
            r.storeCode ?? '—', formatNumber(r.walkIns), formatNumber(r.converted), pct(r.converted, r.walkIns), formatNumber(r.bills), formatCurrency(r.sales),
            r.bills ? formatCurrency(r.sales / r.bills) : '—', formatNumber(r.calls), `${formatNumber(r.connected)} · ${pct(r.connected, r.calls)}`,
          ])} minWidth="64rem" />
      </Card>
    </ReportShell>
  );
}
