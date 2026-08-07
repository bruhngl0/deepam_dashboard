/**
 * Analysis queries — cuts on the data nobody currently gets: basket size
 * distribution, when the stores actually sell, who's selling it, and which
 * customers carry repeat + high value versus a single large bill.
 *
 * Deliberately not "forecasting". Only 8 days of sales are loaded (D-04's
 * "indefinite retention" hasn't accumulated multiple weeks yet), so a trend
 * line or a churn-by-recency score would be fitted to a single week and
 * would misstate its own confidence. Everything here is a same-period cut,
 * not a projection — the page says so, not just this comment.
 */

import { db } from '@/db';
import { sql } from 'drizzle-orm';

type Row = Record<string, unknown>;

async function query(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every query in this module builds raw SQL text (see `query` above), so a
 * batch id headed into a WHERE clause has to be provably not SQL before it's
 * spliced in. It ultimately comes from a URL search param — validating the
 * shape is what makes that safe rather than trusting the caller.
 */
function batchClause(column: string, batchId?: string | null): string {
  if (!batchId) return '';
  if (!UUID_RE.test(batchId)) throw new Error(`Invalid batch id: ${batchId}`);
  return `AND ${column} = '${batchId}'`;
}

export interface SalesReport {
  id: string;
  fileName: string;
  bills: number;
  revenue: number;
  from: string;
  to: string;
}

/**
 * One row per committed sales import batch — what the report dropdown on the
 * Analysis page lists. Sales are never replaced or merged across imports
 * (D-04), so each batch is a distinct billing period a user uploaded once.
 */
export async function getSalesReports(): Promise<SalesReport[]> {
  const rows = await query(`
    SELECT ib.id::text                              AS id,
           ib.file_name                              AS file_name,
           COUNT(s.id)::int                          AS bills,
           COALESCE(SUM(s.bill_amount), 0)::numeric  AS revenue,
           MIN(s.billed_at AT TIME ZONE 'Asia/Kolkata')::date AS from_date,
           MAX(s.billed_at AT TIME ZONE 'Asia/Kolkata')::date AS to_date
    FROM   import_batches ib
    JOIN   sales s ON s.batch_id = ib.id
    WHERE  ib.source_kind = 'sale' AND ib.status = 'committed'
    GROUP  BY ib.id, ib.file_name
    ORDER  BY MIN(s.billed_at) DESC`);

  return rows.map((r) => ({
    id: String(r.id),
    fileName: String(r.file_name),
    bills: Number(r.bills ?? 0),
    revenue: Number(r.revenue ?? 0),
    from: String(r.from_date),
    to: String(r.to_date),
  }));
}

export interface CustomerSegment {
  segment: 'repeat_high' | 'repeat_low' | 'one_time_high' | 'one_time_low';
  label: string;
  description: string;
  people: number;
  revenue: number;
  avgSpend: number;
  shareOfRevenue: number;
}

const SEGMENT_META: Record<CustomerSegment['segment'], { label: string; description: string }> = {
  repeat_high: {
    label: 'Core repeat customers',
    description: 'Bought more than once and sit in the top 30% by lifetime spend.',
  },
  repeat_low: {
    label: 'Frequent, smaller basket',
    description: 'Bought more than once, outside the top 30% by spend.',
  },
  one_time_high: {
    label: 'High-value first purchase',
    description: 'One bill so far, but it put them in the top 30% by spend.',
  },
  one_time_low: {
    label: 'One-time buyers',
    description: 'A single, smaller bill. The largest group by people, rarely by revenue.',
  },
};

const SEGMENT_ORDER: CustomerSegment['segment'][] = [
  'repeat_high',
  'repeat_low',
  'one_time_high',
  'one_time_low',
];

/**
 * Frequency (repeat vs one-time) crossed with value (top-30%-by-spend vs the
 * rest, reusing the same decile cut as the dashboard's value tiers so this
 * never disagrees with that panel). This is the RFM "F" and "M" — "R"ecency
 * is deliberately left out: with 8 days loaded, every customer's most recent
 * purchase is within the same week, so a recency score would just repeat the
 * calendar back rather than say anything about churn risk.
 */
export async function getCustomerSegments(batchId?: string | null): Promise<{
  segments: CustomerSegment[];
  totalPeople: number;
  totalRevenue: number;
}> {
  // Computed straight from `sales` rather than the `customer_attribution` MV
  // (whose totals are always lifetime) so the value band — top 30% by spend —
  // is ranked within whichever report is selected, not globally, when one is.
  const rows = await query(`
    WITH scoped AS (
      SELECT customer_id, bill_amount
      FROM   sales
      WHERE  customer_id IS NOT NULL ${batchClause('batch_id', batchId)}
    ),
    agg AS (
      SELECT customer_id,
             COUNT(*)::int    AS bill_count,
             SUM(bill_amount) AS total_sales
      FROM   scoped GROUP BY customer_id
    ),
    ranked AS (
      SELECT customer_id, bill_count, total_sales,
             NTILE(10) OVER (ORDER BY total_sales DESC, customer_id) AS decile
      FROM   agg
    ),
    segments AS (
      SELECT CASE WHEN bill_count >= 2 THEN 'repeat' ELSE 'one_time' END AS frequency_band,
             CASE WHEN decile <= 3 THEN 'high' ELSE 'low' END           AS value_band,
             total_sales
      FROM   ranked
    )
    SELECT frequency_band, value_band,
           COUNT(*)::int                          AS people,
           COALESCE(SUM(total_sales), 0)::numeric AS revenue
    FROM   segments GROUP BY 1, 2`);

  const totalRevenue = rows.reduce((n, r) => n + Number(r.revenue ?? 0), 0);
  const totalPeople = rows.reduce((n, r) => n + Number(r.people ?? 0), 0);

  // SQL yields frequency_band ('repeat'|'one_time') × value_band ('high'|'low');
  // joined with '_' it lines up exactly with `CustomerSegment['segment']`.
  const bySegment = new Map<string, { people: number; revenue: number }>();
  for (const r of rows) {
    bySegment.set(`${r.frequency_band}_${r.value_band}`, {
      people: Number(r.people ?? 0),
      revenue: Number(r.revenue ?? 0),
    });
  }

  const segments = SEGMENT_ORDER.map((segment) => {
    const found = bySegment.get(segment);
    const people = found?.people ?? 0;
    const revenue = found?.revenue ?? 0;
    return {
      segment,
      label: SEGMENT_META[segment].label,
      description: SEGMENT_META[segment].description,
      people,
      revenue,
      avgSpend: people ? revenue / people : 0,
      shareOfRevenue: totalRevenue ? (100 * revenue) / totalRevenue : 0,
    };
  });

  return { segments, totalPeople, totalRevenue };
}

export interface OrderValueRow {
  key: string;
  bills: number;
  meanBill: number;
  medianBill: number;
  p90Bill: number;
}

export interface OrderValueDistribution {
  byStore: OrderValueRow[];
  byChannel: OrderValueRow[];
}

/**
 * Median and p90 bill size, not just the average that already sits on every
 * other panel. A mean gets pulled hard by a handful of large saree
 * purchases; the gap between mean and median on a row is the skew itself.
 */
export async function getOrderValueDistribution(batchId?: string | null): Promise<OrderValueDistribution> {
  const byStore = await query(`
    SELECT st.name AS key,
           COUNT(*)::int                                                        AS bills,
           ROUND(AVG(s.bill_amount))::bigint                                    AS mean_bill,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.bill_amount))::bigint AS median_bill,
           ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY s.bill_amount))::bigint AS p90_bill
    FROM   sales s JOIN stores st ON st.id = s.store_id
    WHERE  TRUE ${batchClause('s.batch_id', batchId)}
    GROUP  BY st.name ORDER BY median_bill DESC`);

  const byChannel = await query(`
    SELECT COALESCE(ca.primary_channel::text, 'unmatched') AS key,
           COUNT(*)::int                                                        AS bills,
           ROUND(AVG(s.bill_amount))::bigint                                    AS mean_bill,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.bill_amount))::bigint AS median_bill,
           ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY s.bill_amount))::bigint AS p90_bill
    FROM   sales s
    LEFT   JOIN customer_attribution ca ON ca.customer_id = s.customer_id
    WHERE  TRUE ${batchClause('s.batch_id', batchId)}
    GROUP  BY 1 ORDER BY median_bill DESC NULLS LAST`);

  const map = (rows: Row[]): OrderValueRow[] =>
    rows.map((r) => ({
      key: String(r.key),
      bills: Number(r.bills ?? 0),
      meanBill: Number(r.mean_bill ?? 0),
      medianBill: Number(r.median_bill ?? 0),
      p90Bill: Number(r.p90_bill ?? 0),
    }));

  return { byStore: map(byStore), byChannel: map(byChannel) };
}

export interface DayRow {
  dow: number;
  label: string;
  bills: number;
  revenue: number;
}

export interface TimeBandRow {
  band: number;
  label: string;
  bills: number;
  revenue: number;
}

const DAY_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BAND_LABEL = ['Morning · before 12pm', 'Afternoon · 12–5pm', 'Evening · 5–9pm', 'Night · after 9pm'];

/**
 * When the stores actually sell — day of week and time of day, both in IST
 * (`billed_at` is stored UTC, D-32). Useful for staffing, not marketing: this
 * is when checkout happens, which lags "when people decided to buy" by
 * whatever the in-store dwell time is.
 */
export async function getSalesRhythm(
  batchId?: string | null,
): Promise<{ byDay: DayRow[]; byTimeBand: TimeBandRow[] }> {
  const clause = batchClause('batch_id', batchId);

  const dayRows = await query(`
    SELECT EXTRACT(ISODOW FROM billed_at AT TIME ZONE 'Asia/Kolkata')::int AS dow,
           COUNT(*)::int                          AS bills,
           COALESCE(SUM(bill_amount), 0)::numeric AS revenue
    FROM   sales WHERE TRUE ${clause} GROUP BY 1 ORDER BY 1`);

  const bandRows = await query(`
    SELECT (CASE
              WHEN EXTRACT(HOUR FROM billed_at AT TIME ZONE 'Asia/Kolkata') < 12 THEN 0
              WHEN EXTRACT(HOUR FROM billed_at AT TIME ZONE 'Asia/Kolkata') < 17 THEN 1
              WHEN EXTRACT(HOUR FROM billed_at AT TIME ZONE 'Asia/Kolkata') < 21 THEN 2
              ELSE 3
            END)::int                              AS band,
           COUNT(*)::int                          AS bills,
           COALESCE(SUM(bill_amount), 0)::numeric AS revenue
    FROM   sales WHERE TRUE ${clause} GROUP BY 1 ORDER BY 1`);

  const byDay = dayRows.map((r) => ({
    dow: Number(r.dow),
    label: DAY_LABEL[Number(r.dow)] ?? String(r.dow),
    bills: Number(r.bills ?? 0),
    revenue: Number(r.revenue ?? 0),
  }));

  const byTimeBand = bandRows.map((r) => ({
    band: Number(r.band),
    label: BAND_LABEL[Number(r.band)] ?? String(r.band),
    bills: Number(r.bills ?? 0),
    revenue: Number(r.revenue ?? 0),
  }));

  return { byDay, byTimeBand };
}

export interface SalesmanRow {
  code: string;
  store: string;
  bills: number;
  revenue: number;
  avgBill: number;
}

/**
 * Revenue and bill count per salesman code — an ops/staffing view, not an
 * individual scorecard. `salesman_code` is populated on 841 of 847 bills.
 * Capped at 12 rows: 40 distinct codes exist, and a ranked list past the
 * first dozen stops being something anyone reads.
 */
export async function getSalesmanPerformance(batchId?: string | null): Promise<SalesmanRow[]> {
  const rows = await query(`
    SELECT COALESCE(NULLIF(TRIM(s.salesman_code), ''), 'Unassigned') AS code,
           st.name                                    AS store,
           COUNT(*)::int                               AS bills,
           COALESCE(SUM(s.bill_amount), 0)::numeric    AS revenue,
           ROUND(AVG(s.bill_amount))::bigint           AS avg_bill
    FROM   sales s JOIN stores st ON st.id = s.store_id
    WHERE  TRUE ${batchClause('s.batch_id', batchId)}
    GROUP  BY 1, 2 ORDER BY revenue DESC LIMIT 12`);

  return rows.map((r) => ({
    code: String(r.code),
    store: String(r.store),
    bills: Number(r.bills ?? 0),
    revenue: Number(r.revenue ?? 0),
    avgBill: Number(r.avg_bill ?? 0),
  }));
}
