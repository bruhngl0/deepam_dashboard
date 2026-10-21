import { requireUser } from '@/lib/auth';
import { cohorts } from '@/lib/analytics/reports';
import { todayIst } from '@/lib/queries/daily';
import { formatNumber } from '@/lib/format';
import { Card, pct, ReportShell, Table } from '../report-shell';

export const dynamic = 'force-dynamic';

const monthLabel = (month: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${month}T12:00:00+05:30`));
/** A cohort can only be judged on a window that has fully passed for all of its customers. */
const closed = (month: string, months: number) => {
  const end = new Date(`${month}T00:00:00+05:30`);
  end.setMonth(end.getMonth() + 1 + months);
  return end.toISOString().slice(0, 10) <= todayIst();
};

export default async function CohortsPage() {
  await requireUser();
  const rows = await cohorts().catch(() => []);
  const cell = (r: (typeof rows)[number], back: number, months: number) => (closed(r.month, months) ? `${pct(back, r.customers)} · ${formatNumber(back)}` : '—');

  return (
    <ReportShell title="Cohorts" current="/reports/cohorts"
      intro="Customers grouped by the month of their first bill: the share who bought again within 1, 3 and 6 months of it, and the typical gap before the next bill. A window shows — until it has passed for everyone in that month.">
      <Card>
        <Table head={['First bill', 'Customers', 'Back within 1 month', 'Within 3 months', 'Within 6 months', 'Typical days to return']}
          rows={rows.map((r) => [monthLabel(r.month), formatNumber(r.customers), cell(r, r.back1, 1), cell(r, r.back3, 3), cell(r, r.back6, 6), r.medianDays === null ? '—' : formatNumber(r.medianDays)])} />
      </Card>
    </ReportShell>
  );
}
