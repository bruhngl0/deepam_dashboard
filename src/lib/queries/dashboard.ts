/**
 * Dashboard metric queries.
 *
 * The single definition of every KPI (D-76). Server Components and any future
 * REST route both read from here, so "conversion rate" cannot come to mean two
 * slightly different things in two places.
 *
 * The denominator rule (D-46): existing customers are excluded from Total Leads
 * and Conversion Rate, because that group is defined by having bought and its
 * conversion rate is 100% by construction. Their revenue still counts toward
 * Total Sales — it is real money.
 */

import { db } from '@/db';
import { sql } from 'drizzle-orm';

type Row = Record<string, unknown>;

async function query(text: string, params: unknown[] = []): Promise<Row[]> {
  const result = (await db.execute(
    params.length ? sql.raw(text) : sql.raw(text),
  )) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

export interface DashboardFilters {
  store?: string | null; // store code
  channel?: string | null;
  lifecycle?: string | null;
}

export interface Kpis {
  totalLeads: number;
  leadsConverted: number;
  conversionRate: number;
  grossSales: number;
  newCustomerRevenue: number;
  existingPeople: number;
  existingBuyers: number;
  existingRevenue: number;
  phonelessBills: number;
  phonelessRevenue: number;
  totalBills: number;
}

export async function getKpis(): Promise<Kpis> {
  const [row] = await query(`
    WITH funnel AS (
      SELECT COUNT(*)::int AS leads,
             COUNT(*) FILTER (WHERE converted)::int AS converted,
             COALESCE(SUM(total_sales) FILTER (WHERE converted), 0)::numeric AS new_rev
      FROM   customer_attribution
      WHERE  in_acquisition_funnel
    ),
    existing AS (
      SELECT COUNT(*)::int AS people,
             COUNT(*) FILTER (WHERE converted)::int AS buyers,
             COALESCE(SUM(total_sales), 0)::numeric AS rev
      FROM   customer_attribution
      WHERE  lifecycle = 'existing'
    ),
    bills AS (
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(bill_amount), 0)::numeric AS gross,
             COUNT(*) FILTER (WHERE customer_id IS NULL)::int AS phoneless_n,
             COALESCE(SUM(bill_amount) FILTER (WHERE customer_id IS NULL), 0)::numeric AS phoneless_rev
      FROM   sales
    )
    SELECT f.leads, f.converted, f.new_rev,
           e.people, e.buyers, e.rev,
           b.n, b.gross, b.phoneless_n, b.phoneless_rev
    FROM funnel f, existing e, bills b`);

  const leads = Number(row.leads ?? 0);
  const converted = Number(row.converted ?? 0);

  return {
    totalLeads: leads,
    leadsConverted: converted,
    conversionRate: leads ? (100 * converted) / leads : 0,
    grossSales: Number(row.gross ?? 0),
    newCustomerRevenue: Number(row.new_rev ?? 0),
    existingPeople: Number(row.people ?? 0),
    existingBuyers: Number(row.buyers ?? 0),
    existingRevenue: Number(row.rev ?? 0),
    phonelessBills: Number(row.phoneless_n ?? 0),
    phonelessRevenue: Number(row.phoneless_rev ?? 0),
    totalBills: Number(row.n ?? 0),
  };
}

export interface ChannelRow {
  channel: string;
  basis: string | null;
  people: number;
  buyers: number;
  conversionRate: number;
  revenue: number;
}

/** Exclusive-mode split — these rows sum exactly to the total. (D-41, D-42) */
export async function getChannelBreakdown(): Promise<ChannelRow[]> {
  const rows = await query(`
    SELECT primary_channel::text AS channel,
           lifecycle_basis::text AS basis,
           COUNT(*)::int AS people,
           COUNT(*) FILTER (WHERE converted)::int AS buyers,
           COALESCE(SUM(total_sales), 0)::numeric AS revenue
    FROM   customer_attribution
    GROUP  BY 1, 2
    ORDER  BY people DESC`);

  return rows.map((r) => {
    const people = Number(r.people ?? 0);
    const buyers = Number(r.buyers ?? 0);
    return {
      channel: String(r.channel),
      basis: r.basis ? String(r.basis) : null,
      people,
      buyers,
      conversionRate: people ? (100 * buyers) / people : 0,
      revenue: Number(r.revenue ?? 0),
    };
  });
}

export interface StoreRow {
  code: string;
  name: string;
  voucherPrefix: string | null;
  bills: number;
  revenue: number;
  submissions: number;
}

export async function getStoreBreakdown(): Promise<StoreRow[]> {
  const rows = await query(`
    SELECT st.code, st.name, st.voucher_prefix,
           COUNT(s.id)::int AS bills,
           COALESCE(SUM(s.bill_amount), 0)::numeric AS revenue,
           (SELECT COUNT(*)::int FROM walkin_submissions w WHERE w.store_id = st.id) AS submissions
    FROM   stores st
    LEFT   JOIN sales s ON s.store_id = st.id
    GROUP  BY st.id, st.code, st.name, st.voucher_prefix
    ORDER  BY revenue DESC`);

  return rows.map((r) => ({
    code: String(r.code),
    name: String(r.name),
    voucherPrefix: r.voucher_prefix ? String(r.voucher_prefix) : null,
    bills: Number(r.bills ?? 0),
    revenue: Number(r.revenue ?? 0),
    submissions: Number(r.submissions ?? 0),
  }));
}

export interface DataQuality {
  rejectedUnresolved: number;
  rejectsByCode: { code: string; n: number }[];
  phonelessBills: number;
  phonelessRevenue: number;
  inferredExisting: number;
  inferredExistingRevenue: number;
  estimatedTouches: number;
  missingCity: number;
}

/**
 * The gaps, shown rather than smoothed over. Every one of these silently
 * distorts a KPI if it goes unmentioned. (D-56)
 */
export async function getDataQuality(): Promise<DataQuality> {
  const [row] = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM import_rows_rejected WHERE NOT resolved) AS rejected,
      (SELECT COUNT(*)::int FROM sales WHERE customer_id IS NULL) AS phoneless_n,
      (SELECT COALESCE(SUM(bill_amount),0)::numeric FROM sales WHERE customer_id IS NULL) AS phoneless_rev,
      (SELECT COUNT(*)::int FROM customers WHERE lifecycle_basis = 'no_lead_match') AS inferred,
      (SELECT COALESCE(SUM(total_sales),0)::numeric FROM customer_attribution
        WHERE lifecycle_basis = 'no_lead_match') AS inferred_rev,
      (SELECT COUNT(*)::int FROM lead_touches WHERE touched_at_is_estimated) AS estimated,
      (SELECT COUNT(*)::int FROM customers WHERE city IS NULL) AS no_city`);

  const codes = await query(`
    SELECT error_code, COUNT(*)::int AS n
    FROM   import_rows_rejected WHERE NOT resolved
    GROUP  BY 1 ORDER BY n DESC`);

  return {
    rejectedUnresolved: Number(row.rejected ?? 0),
    rejectsByCode: codes.map((c) => ({ code: String(c.error_code), n: Number(c.n ?? 0) })),
    phonelessBills: Number(row.phoneless_n ?? 0),
    phonelessRevenue: Number(row.phoneless_rev ?? 0),
    inferredExisting: Number(row.inferred ?? 0),
    inferredExistingRevenue: Number(row.inferred_rev ?? 0),
    estimatedTouches: Number(row.estimated ?? 0),
    missingCity: Number(row.no_city ?? 0),
  };
}

export interface FollowupRow {
  remark: string;
  n: number;
}

export async function getFollowupOutcomes(): Promise<FollowupRow[]> {
  const rows = await query(`
    SELECT final_remark::text AS remark, COUNT(*)::int AS n
    FROM   lead_followups GROUP BY 1 ORDER BY n DESC`);
  return rows.map((r) => ({ remark: String(r.remark), n: Number(r.n ?? 0) }));
}
