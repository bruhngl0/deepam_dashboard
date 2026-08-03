/**
 * KPI row.
 *
 * A handful of headline numbers is a row of stat tiles, not a grouped bar
 * chart. Exactly one hero figure per view — Total Leads, in the dark lead card.
 * Values use the app sans and proportional figures; tabular figures are for
 * columns, where digits must align.
 *
 * Tiles in the revenue row state their definition below a hairline; the leads
 * row carries none. That row is four counts of one thing, read together and
 * mostly self-evident from the label. The revenue row is a partition of the
 * same rupees three ways, where "new" and "already" differ only by whether the
 * buyer turned up on a lead sheet — a distinction nobody recovers from the
 * label alone, and the one that gets misquoted in meetings.
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
    <div className="flex flex-col rounded-2xl bg-dark-card px-6 py-5 text-on-dark shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-white/55">
        {label}
      </p>
      <p className="mt-2 text-5xl font-semibold leading-none tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-white/60">{caption}</p>
    </div>
  );
}

/** `definition` is optional — the leads row carries none. */
export function StatTile({
  label,
  value,
  caption,
  definition,
  emphasis,
}: {
  label: string;
  value: string;
  caption: string;
  definition?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface px-6 py-5 shadow-sm">
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
      {definition && (
        <p className="mt-3 border-t border-grid pt-3 text-xs leading-relaxed text-ink-muted">
          {definition}
        </p>
      )}
    </div>
  );
}

export function KpiRow({
  totalLeads,
  leadsConverted,
  conversionRate,
  attributedRevenue,
}: {
  totalLeads: number;
  leadsConverted: number;
  conversionRate: number;
  attributedRevenue: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <HeroTile
        label="Total leads"
        value={formatNumber(totalLeads)}
        caption="Distinct people across the four lists"
      />
      <StatTile
        label="Leads converted"
        value={formatNumber(leadsConverted)}
        caption="Matched a bill"
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
 * Where the money sits — a reconciliation, not a set of related figures.
 *
 * The first three tiles partition every rupee the business billed, and the
 * fourth is their total. They are disjoint by construction: `newRevenue` uses
 * the D-46 funnel, which excludes anyone flagged existing; `existingRevenue`
 * counts exactly those people business-wide; phone-less bills carry no customer
 * at all. So new + already + phone-less = total sales, exactly (D-50), and the
 * last tile says so out loud — a reader can check the row adds up without
 * leaving the page, which is the fastest way to earn trust in the rest of it.
 *
 * Splitting new from already-existing is the point: folding them together
 * overstates what the campaigns acquired, and hiding the second understates the
 * money. Phone-less is the third because it is the honest ceiling — revenue no
 * attribution rule can ever reach.
 */
export function RevenueRow({
  newLeads,
  newConverted,
  newRevenue,
  existingPeople,
  existingBuyers,
  existingRevenue,
  existingBills,
  phonelessBills,
  phonelessRevenue,
  grossSales,
  totalBills,
  attributedBills,
}: {
  newLeads: number;
  newConverted: number;
  newRevenue: number;
  existingPeople: number;
  existingBuyers: number;
  existingRevenue: number;
  existingBills: number;
  phonelessBills: number;
  phonelessRevenue: number;
  grossSales: number;
  totalBills: number;
  attributedBills: number;
}) {
  const traceable = grossSales ? (100 * (newRevenue + existingRevenue)) / grossSales : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="New customers"
        value={formatCurrencyCompact(newRevenue)}
        caption={`${formatNumber(newConverted)} buyers of ${formatNumber(newLeads)} leads · ${formatNumber(attributedBills)} bills`}
        definition="Bought and are also on the leadsheet."
        emphasis
      />
      <StatTile
        label="Already customers"
        value={formatCurrencyCompact(existingRevenue)}
        caption={`${formatNumber(existingBuyers)} buyers of ${formatNumber(existingPeople)} · ${formatNumber(existingBills)} bills`}
        definition="Bought, but not on leadsheet."
      />
      <StatTile
        label="Phone-less bills"
        value={formatCurrencyCompact(phonelessRevenue)}
        caption={`${formatNumber(phonelessBills)} bills · no number captured`}
        definition="No phone was taken at billing, so these can never match a lead even in principle. The ceiling on what attribution can explain."
      />
      <StatTile
        label="Total sales"
        value={formatCurrencyCompact(grossSales)}
        caption={`${formatCurrency(grossSales)} · ${formatNumber(totalBills)} bills`}
        definition={`Every bill in the period. The three tiles beside it sum to exactly this, and ${traceable.toFixed(1)}% of it traces to a known person.`}
      />
    </div>
  );
}
