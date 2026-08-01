/**
 * KPI row.
 *
 * A handful of headline numbers is a row of stat tiles, not a grouped bar
 * chart. Exactly one hero figure per view — Total Leads, in the dark lead card.
 * Values use the app sans and proportional figures; tabular figures are for
 * columns, where digits must align.
 */

import { formatNumber, formatCurrency, formatCurrencyCompact } from '@/lib/format';

export function HeroTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="rounded-2xl bg-dark-card px-6 py-5 text-on-dark shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-white/55">
        {label}
      </p>
      <p className="mt-2 text-5xl font-semibold leading-none tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-white/60">{caption}</p>
    </div>
  );
}

export function StatTile({
  label,
  value,
  caption,
  emphasis,
}: {
  label: string;
  value: string;
  caption: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-6 py-5 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-muted">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl font-semibold leading-none tracking-tight ${
          emphasis ? 'text-accent' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="mt-2 text-sm text-ink-2">{caption}</p>
    </div>
  );
}

export function KpiRow({
  totalLeads,
  leadsConverted,
  conversionRate,
  attributedRevenue,
  attributedBills,
}: {
  totalLeads: number;
  leadsConverted: number;
  conversionRate: number;
  attributedRevenue: number;
  attributedBills: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <HeroTile
        label="Total leads"
        value={formatNumber(totalLeads)}
        caption="Distinct people on the two lists"
      />
      <StatTile
        label="Leads converted"
        value={formatNumber(leadsConverted)}
        caption={`Matched a bill · ${formatNumber(attributedBills)} bills`}
      />
      <StatTile
        label="Attributed sales"
        value={formatCurrencyCompact(attributedRevenue)}
        caption={formatCurrency(attributedRevenue)}
      />
      <StatTile
        label="Conversion rate"
        value={`${conversionRate.toFixed(2)}%`}
        caption="Converted ÷ total leads"
      />
    </div>
  );
}

/**
 * The headline above counts every in-scope lead. This row splits it, because
 * the two segments answer different questions: `newRevenue` is what the
 * campaigns *acquired*, `existingRevenue` is spend from people who were already
 * customers and would likely have bought regardless. Folding them together
 * would overstate the campaigns; hiding the second would understate the money.
 */
export function SegmentRow({
  newLeads,
  newConverted,
  newRevenue,
  existingPeople,
  existingBuyers,
  existingRevenue,
  grossSales,
  totalBills,
}: {
  newLeads: number;
  newConverted: number;
  newRevenue: number;
  existingPeople: number;
  existingBuyers: number;
  existingRevenue: number;
  grossSales: number;
  totalBills: number;
}) {
  const attributed = newRevenue + existingRevenue;
  const share = grossSales ? (100 * attributed) / grossSales : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatTile
        label="New customers"
        value={formatCurrencyCompact(newRevenue)}
        caption={`${formatNumber(newConverted)} buyers of ${formatNumber(newLeads)} leads · foreign numbers excluded`}
        emphasis
      />
      <StatTile
        label="Already customers"
        value={formatCurrencyCompact(existingRevenue)}
        caption={`${formatNumber(existingBuyers)} buyers of ${formatNumber(existingPeople)} · said so on the form`}
      />
      <StatTile
        label="Share of all revenue"
        value={`${share.toFixed(1)}%`}
        caption={`of ${formatCurrencyCompact(grossSales)} across ${formatNumber(totalBills)} bills, all channels`}
      />
    </div>
  );
}
