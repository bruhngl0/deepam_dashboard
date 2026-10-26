import { requireUser } from '@/lib/auth';
import { campaignPayback, driverPayback, periodFrom, reportStores } from '@/lib/analytics/reports';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Card, PeriodForm, pct, ReportShell, Table } from '../report-shell';

export const dynamic = 'force-dynamic';

const times = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}×`);

export default async function PaybackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const period = periodFrom(await searchParams);
  const [drivers, campaigns, stores] = await Promise.all([driverPayback(period).catch(() => []), campaignPayback(period).catch(() => []), reportStores().catch(() => [])]);

  return (
    <ReportShell title="Payback" current="/reports/payback"
      intro="What drivers and campaigns brought in against what they cost."
      actions={<PeriodForm action="/reports/payback" from={period.from} to={period.to} stores={stores} store={period.store} />}>
      <Card title="Drivers" note="Visits in the period (to the picked store). Sales = RC's bill amount on the visit, else the bill matched to its walk-in. Commission owed = not yet marked paid.">
        <Table head={['Driver', 'Visits', 'People', 'Billed visits', 'Total sales', 'Commission', 'Sales per ₹1 commission', 'Commission owed']}
          rows={drivers.map((d) => [
            <span key="n">{d.name}<span className="block text-xs font-normal text-ink-muted">{d.driverCode}</span></span>,
            formatNumber(d.visits), formatNumber(d.people), `${formatNumber(d.billedVisits)} · ${pct(d.billedVisits, d.visits)}`, formatCurrency(d.sales),
            formatCurrency(d.commission), times(d.commission > 0 ? d.sales / d.commission : null), formatCurrency(d.owed),
          ])} minWidth="60rem" />
      </Card>
      <Card title="Campaigns" note="Leads that arrived in the period (for the picked store) and what they did since. Spend, cost per lead and sales per ₹1 are each campaign's all-time figures: spend comes as campaign totals from the Campaign Summary tabs, so it cannot be split by date or store. Sales = bills by its leads after they became a lead.">
        <Table head={['Campaign', 'Spend (all time)', 'Leads', 'Cost per lead (all time)', 'Called', 'Walked in', 'Bought', 'Total sales', 'Sales per ₹1 spent (all time)']}
          rows={campaigns.map((c) => [
            <span key="n">{c.name}{c.channel && <span className="block text-xs font-normal text-ink-muted">{c.channel}</span>}</span>,
            c.spend === null ? '—' : formatCurrency(c.spend), formatNumber(c.leads), c.costPerLead === null ? '—' : formatCurrency(c.costPerLead),
            formatNumber(c.called), formatNumber(c.walkedIn), `${formatNumber(c.converted)} · ${pct(c.converted, c.leads)}`, formatCurrency(c.sales), times(c.salesPerRupee),
          ])} minWidth="64rem" />
      </Card>
    </ReportShell>
  );
}
