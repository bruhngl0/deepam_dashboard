import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { ReportShell, REPORTS } from './report-shell';

export const dynamic = 'force-dynamic';

const ABOUT: Record<string, string> = {
  '/reports/funnel': 'Leads through to calls, walk-ins, bills and repeat purchases, by store, source or campaign.',
  '/reports/salespeople': 'Per Salesperson ID: walk-ins served, conversion rate, sales, average bill value and calls.',
  '/reports/payback': 'Drivers: sales from their visits against commission. Campaigns: spend against leads and sales.',
  '/reports/cohorts': 'Customers by month of first bill, and how many bought again within 1, 3 and 6 months.',
  '/reports/stock': 'Stock and aged stock per store, its trend, sell-through and slow movers.',
  '/reports/salespeople/match': 'Match the names each app uses for a salesperson to their Salesperson ID.',
};

export default async function ReportsPage() {
  await requireUser();
  return (
    <ReportShell title="Reports" current="/reports" intro="Every app's data in one place, with each figure worked out the same way everywhere.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href} className="card rounded-2xl border border-line bg-surface p-5 hover:bg-inset">
            <h2 className="text-base font-semibold text-ink">{r.label}</h2>
            <p className="mt-1 text-sm text-ink-2">{ABOUT[r.href]}</p>
          </Link>
        ))}
      </div>
    </ReportShell>
  );
}
