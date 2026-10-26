import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { funnel, FUNNEL_GROUPS, periodFrom, reportStores, type FunnelGroup } from '@/lib/analytics/reports';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Card, PeriodForm, pct, ReportShell, Table } from '../report-shell';

export const dynamic = 'force-dynamic';

export default async function FunnelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const period = periodFrom(sp);
  const by: FunnelGroup = (Object.keys(FUNNEL_GROUPS) as FunnelGroup[]).find((k) => k === sp.by) ?? 'store';
  const [rows, stores] = await Promise.all([funnel(period, by).catch(() => []), reportStores().catch(() => [])]);
  const total = rows.reduce((t, r) => ({ leads: t.leads + r.leads, called: t.called + r.called, walkedIn: t.walkedIn + r.walkedIn, bought: t.bought + r.bought, boughtAgain: t.boughtAgain + r.boughtAgain, sales: t.sales + r.sales }),
    { leads: 0, called: 0, walkedIn: 0, bought: 0, boughtAgain: 0, sales: 0 });
  const row = (label: React.ReactNode, r: typeof total) => [
    label, formatNumber(r.leads), `${formatNumber(r.called)} · ${pct(r.called, r.leads)}`, `${formatNumber(r.walkedIn)} · ${pct(r.walkedIn, r.leads)}`,
    `${formatNumber(r.bought)} · ${pct(r.bought, r.leads)}`, `${formatNumber(r.boughtAgain)} · ${pct(r.boughtAgain, r.bought)}`, formatCurrency(r.sales),
  ];
  const q = (k: FunnelGroup) => `/reports/funnel?${new URLSearchParams({ from: period.from, to: period.to, by: k, ...(period.store ? { store: period.store } : {}) })}`;

  return (
    <ReportShell title="Funnel" current="/reports/funnel"
      intro="Leads that arrived in the period, and what each did afterwards: called, walked in, bought, bought again. Percentages are of leads, except Bought again, which is of those who bought."
      actions={<PeriodForm action="/reports/funnel" from={period.from} to={period.to} stores={stores} store={period.store} keep={{ by }} />}>
      <nav aria-label="Group by" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-2">By</span>
        {(Object.keys(FUNNEL_GROUPS) as FunnelGroup[]).map((k) => (
          <Link key={k} href={q(k)} aria-current={k === by ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 font-medium ${k === by ? 'bg-inset text-ink' : 'text-ink-2 hover:bg-inset hover:text-ink'}`}>{FUNNEL_GROUPS[k]}</Link>
        ))}
      </nav>
      <Card title={`Leads by ${FUNNEL_GROUPS[by].toLowerCase()}`} note="Sales = bills by these people after they became a lead.">
        <Table head={[FUNNEL_GROUPS[by], 'Leads', 'Called', 'Walked in', 'Bought', 'Bought again', 'Sales']}
          rows={[...rows.map((r) => row(r.label, r)), ...(rows.length > 1 ? [row(<strong key="t">Total</strong>, total)] : [])]} minWidth="56rem" />
      </Card>
    </ReportShell>
  );
}
