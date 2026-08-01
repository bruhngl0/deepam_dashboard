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
  grossSales,
  showing,
}: {
  totalLeads: number;
  leadsConverted: number;
  conversionRate: number;
  grossSales: number;
  showing: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <HeroTile
        label="Total leads"
        value={formatNumber(totalLeads)}
        caption="New-customer prospects"
      />
      <StatTile
        label="Leads converted"
        value={formatNumber(leadsConverted)}
        caption="Leads with a purchase"
      />
      <StatTile
        label="Total sales"
        value={formatCurrencyCompact(grossSales)}
        caption={formatCurrency(grossSales)}
      />
      <StatTile
        label="Conversion rate"
        value={`${conversionRate.toFixed(1)}%`}
        caption="Converted ÷ total leads"
      />
      <StatTile
        label="Showing"
        value={formatNumber(showing)}
        caption="On this page"
      />
    </div>
  );
}

export function SegmentRow({
  newRevenue,
  existingRevenue,
  existingPeople,
  existingBuyers,
  phonelessRevenue,
  phonelessBills,
}: {
  newRevenue: number;
  existingRevenue: number;
  existingPeople: number;
  existingBuyers: number;
  phonelessRevenue: number;
  phonelessBills: number;
}) {
  const attributable = newRevenue + existingRevenue;
  const newShare = attributable ? (100 * newRevenue) / attributable : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatTile
        label="New customers"
        value={formatCurrencyCompact(newRevenue)}
        caption={`${newShare.toFixed(0)}% of attributed revenue`}
      />
      <StatTile
        label="Existing customers"
        value={formatCurrencyCompact(existingRevenue)}
        caption={`${formatNumber(existingBuyers)} buyers of ${formatNumber(existingPeople)} · ${(100 - newShare).toFixed(0)}% of revenue`}
      />
      <StatTile
        label="Unmatched"
        value={formatCurrencyCompact(phonelessRevenue)}
        caption={`${formatNumber(phonelessBills)} bills with no phone captured`}
      />
    </div>
  );
}
