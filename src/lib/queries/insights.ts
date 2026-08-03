/**
 * Insight queries.
 *
 * These back the /insights route. Every figure on that page is computed here
 * rather than written into the copy, because an insight page whose numbers are
 * typed by hand stops being true the first time data lands and nobody notices.
 * The prose states the shape of a finding; the numbers come from the database.
 *
 * Read straight from `sales` and `customer_attribution` rather than through the
 * dashboard's scoped CTE: these questions are about the whole business — what
 * the money is concentrated in, who buys twice — not about lead attribution.
 *
 * `getStoreChannelMix` lives in `lib/queries/dashboard.ts`, not here: once the
 * branch × channel matrix became a dashboard panel it needed one definition
 * both routes could read, and duplicating a join across two files is how they
 * drift.
 */

import { db } from '@/db';
import { sql } from 'drizzle-orm';

type Row = Record<string, unknown>;

async function query(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

export interface DecileRow {
  decile: number;
  customers: number;
  revenue: number;
  share: number;
  cumulativeShare: number;
}

/**
 * Revenue concentration among phone-matched buyers, in tenths.
 *
 * The headline this supports is that a small group carries most of the money,
 * which is the case against reading this business through conversion rates.
 * Phone-less bills are excluded — they belong to no customer, so they cannot be
 * ranked by customer value.
 */
export async function getRevenueConcentration(): Promise<DecileRow[]> {
  const rows = await query(`
    WITH buyer AS (
      SELECT customer_id, SUM(bill_amount) AS value
      FROM   sales WHERE customer_id IS NOT NULL GROUP BY customer_id
    ),
    ranked AS (
      SELECT value, NTILE(10) OVER (ORDER BY value DESC) AS decile FROM buyer
    )
    SELECT decile::int,
           COUNT(*)::int              AS customers,
           ROUND(SUM(value))::bigint  AS revenue,
           (100 * SUM(value) / NULLIF((SELECT SUM(value) FROM buyer), 0))::float AS share
    FROM   ranked GROUP BY decile ORDER BY decile`);

  let running = 0;
  return rows.map((r) => {
    const share = Number(r.share ?? 0);
    running += share;
    return {
      decile: Number(r.decile),
      customers: Number(r.customers ?? 0),
      revenue: Number(r.revenue ?? 0),
      share,
      cumulativeShare: running,
    };
  });
}

export interface ChannelValueRow {
  channel: string;
  people: number;
  buyers: number;
  conversionRate: number;
  bills: number;
  revenue: number;
  averageBill: number;
  revenuePerBuyer: number;
}

/**
 * Conversion rate beside value per sale — the two disagree, which is the point.
 * Deliberately one table and not a two-axis chart: they are different units and
 * the comparison is the finding, so the reader needs both numbers exactly.
 */
export async function getChannelValue(): Promise<ChannelValueRow[]> {
  const rows = await query(`
    SELECT primary_channel::text AS channel,
           COUNT(*)::int                                   AS people,
           COUNT(*) FILTER (WHERE converted)::int          AS buyers,
           COALESCE(SUM(bill_count), 0)::int               AS bills,
           COALESCE(ROUND(SUM(total_sales)), 0)::bigint    AS revenue
    FROM   customer_attribution
    GROUP  BY 1 ORDER BY revenue DESC`);

  return rows.map((r) => {
    const people = Number(r.people ?? 0);
    const buyers = Number(r.buyers ?? 0);
    const bills = Number(r.bills ?? 0);
    const revenue = Number(r.revenue ?? 0);
    return {
      channel: String(r.channel),
      people,
      buyers,
      conversionRate: people ? (100 * buyers) / people : 0,
      bills,
      revenue,
      averageBill: bills ? revenue / bills : 0,
      revenuePerBuyer: buyers ? revenue / buyers : 0,
    };
  });
}


export interface RepeatRow {
  bills: number;
  customers: number;
  revenue: number;
}

/** How many customers bought more than once inside the loaded period. */
export async function getRepeatPurchase(): Promise<RepeatRow[]> {
  const rows = await query(`
    SELECT bills, COUNT(*)::int AS customers, ROUND(SUM(spend))::bigint AS revenue
    FROM (
      SELECT customer_id, COUNT(*)::int AS bills, SUM(bill_amount) AS spend
      FROM   sales WHERE customer_id IS NOT NULL GROUP BY customer_id
    ) x
    GROUP BY bills ORDER BY bills`);

  return rows.map((r) => ({
    bills: Number(r.bills ?? 0),
    customers: Number(r.customers ?? 0),
    revenue: Number(r.revenue ?? 0),
  }));
}

export interface Completeness {
  total: number;
  fields: { field: string; missing: number; share: number }[];
}

/** What we do and do not know about the people in the database. */
export async function getContactCompleteness(): Promise<Completeness> {
  const [row] = await query(`
    SELECT COUNT(*)::int                                     AS total,
           COUNT(*) FILTER (WHERE full_name IS NULL)::int     AS name,
           COUNT(*) FILTER (WHERE email IS NULL)::int         AS email,
           COUNT(*) FILTER (WHERE city IS NULL)::int          AS city,
           COUNT(*) FILTER (WHERE date_of_birth IS NULL)::int AS dob
    FROM   customers`);

  const total = Number(row.total ?? 0);
  const field = (key: string, label: string) => ({
    field: label,
    missing: Number(row[key] ?? 0),
    share: total ? (100 * Number(row[key] ?? 0)) / total : 0,
  });

  return {
    total,
    fields: [
      field('name', 'No name'),
      field('email', 'No email'),
      field('city', 'No city'),
      field('dob', 'No date of birth'),
    ],
  };
}
