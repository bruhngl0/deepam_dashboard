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
    <div className="hero-card flex flex-col rounded-2xl bg-dark-card px-6 py-5 text-on-dark">
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-white/55">
        {label}
      </p>
      <p className="tnum mt-2 text-5xl font-semibold leading-none tracking-tight">{value}</p>
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
    <div className="card relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface px-6 py-5">
      {emphasis && (
        <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-accent/0 via-accent to-accent/0" />
      )}
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
        {label}
      </p>
      <p
        className={`tnum mt-2 text-3xl font-semibold leading-none tracking-tight ${
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
  totalCustomers,
  historicalCustomers,
  reactivatedCustomers,
  reactivatedSales,
  newCustomers,
  newCustomerBills,
  grossSales,
  totalBills,
}: {
  totalCustomers: number;
  historicalCustomers: number;
  reactivatedCustomers: number;
  reactivatedSales: number;
  newCustomers: number;
  newCustomerBills: number;
  grossSales: number;
  totalBills: number;
}) {
  const averageBill = totalBills ? grossSales / totalBills : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <HeroTile
        label="Total customers"
        value={formatNumber(totalCustomers)}
        caption="Loyalty customers plus new buyers"
      />
      <StatTile
        label="Historical customers"
        value={formatNumber(historicalCustomers)}
        caption="People on the loyalty customer sheet"
      />
      <StatTile
        label="Reactivated customers"
        value={formatNumber(reactivatedCustomers)}
        caption={`${formatCurrencyCompact(reactivatedSales)} in sales in the selected period`}
        definition="Historical customers from the loyalty sheet who bought again in this period."
        emphasis
      />
      <StatTile
        label="New customers"
        value={formatNumber(newCustomers)}
        caption={`${formatNumber(newCustomerBills)} bills from lead-only customers`}
        definition="Bought after appearing on a lead sheet, but are not on the loyalty customer sheet."
      />
      <StatTile
        label="Total sales"
        value={formatCurrencyCompact(grossSales)}
        caption={`${formatCurrency(grossSales)} · ${formatNumber(totalBills)} bills`}
        definition="Every bill in the selected period, including bills that cannot be linked to a customer."
      />
      <StatTile
        label="Average bill value"
        value={formatCurrencyCompact(averageBill)}
        caption={`${formatCurrency(averageBill)} per bill`}
        definition="Total sales divided by every bill in the selected period."
      />
    </div>
  );
}

/**
 * Sales context. The lead and loyalty tiles identify different matched
 * populations; they are not a partition of all billed revenue. A person can be
 * present in both sources, while a buyer absent from both remains visible only
 * in the total-sales tile.
 */
export function RevenueRow({
  newLeads,
  newConverted,
  newRevenue,
  newBills,
  existingPeople,
  existingBuyers,
  existingRevenue,
  existingBills,
  multiSourceBuyers,
  multiSourceRevenue,
  multiSourceBills,
  phonelessBills,
  phonelessRevenue,
  grossSales,
  totalBills,
}: {
  newLeads: number;
  newConverted: number;
  newRevenue: number;
  newBills: number;
  existingPeople: number;
  existingBuyers: number;
  existingRevenue: number;
  existingBills: number;
  multiSourceBuyers: number;
  multiSourceRevenue: number;
  multiSourceBills: number;
  phonelessBills: number;
  phonelessRevenue: number;
  grossSales: number;
  totalBills: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatTile
        label="New customers"
        value={formatCurrencyCompact(newRevenue)}
        caption={`${formatNumber(newConverted)} buyers of ${formatNumber(newLeads)} leads · ${formatNumber(newBills)} bills`}
        definition="On a lead sheet but not on the loyalty customer list."
        emphasis
      />
      <StatTile
        label="Loyalty customer list"
        value={formatCurrencyCompact(existingRevenue)}
        caption={`${formatNumber(existingBuyers)} buyers of ${formatNumber(existingPeople)} · ${formatNumber(existingBills)} bills`}
        definition="Matched to the loyalty/CRM customer list by normalized phone number."
      />
      <StatTile
        label="Sales from multiple sources"
        value={formatCurrencyCompact(multiSourceRevenue)}
        caption={`${formatNumber(multiSourceBuyers)} buyers · ${formatNumber(multiSourceBills)} bills`}
        definition="Matched to sales, the loyalty list, and at least one lead sheet by normalized phone number."
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
        definition="Every bill in the period. The loyalty and multi-source figures may overlap."
      />
    </div>
  );
}
