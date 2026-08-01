/**
 * Customer table query — Instagram and WhatsApp only.
 *
 * Server-side paginated and filtered — the browser never receives more than a
 * page. (D-78) Every filter composes; none silently clears another. (D-82)
 *
 * Each row carries all of its *in-scope* channel touches, not just the
 * attributed one — that is the payoff of keeping `lead_touches` append-only.
 * (D-40, D-79)
 *
 * Scope (D-83): only people with at least one Instagram or WhatsApp touch are
 * listed, and the walk-in-derived columns are gone with the channel. First
 * touch is recomputed over the two in-scope channels rather than read from
 * `customer_attribution`, for the reason set out in `dashboard.ts`.
 */

import { db } from '@/db';
import { sql, type SQL } from 'drizzle-orm';
import { SCOPED_CHANNELS } from './dashboard';

type Row = Record<string, unknown>;

async function query(statement: SQL): Promise<Row[]> {
  const result = (await db.execute(statement)) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

export interface CustomerFilters {
  q?: string;
  store?: string; // store code
  channel?: string; // primary_channel
  lifecycle?: string; // 'new' | 'existing'
  hasSales?: 'yes' | 'no';
  page?: number;
  pageSize?: number;
  sort?: 'sales' | 'recent' | 'name';
}

export interface CustomerRow {
  id: number;
  phoneE164: string;
  fullName: string | null;
  email: string | null;
  area: string | null;
  city: string | null;
  dateOfBirth: string | null;
  anniversary: string | null;
  storeName: string | null;
  lifecycle: string;
  lifecycleBasis: string | null;
  primaryChannel: string | null;
  channels: string[];
  campaigns: string[];
  billCount: number;
  totalSales: number;
  firstSaleAt: string | null;
  firstTouchAt: string | null;
  touchEstimated: boolean;
  finalRemark: string | null;
  call1Made: boolean | null;
}

export interface CustomerPage {
  rows: CustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORTS: Record<string, string> = {
  sales: 'ca.total_sales DESC NULLS LAST, c.id',
  recent: 'c.last_seen_at DESC NULLS LAST, c.id',
  name: 'c.full_name ASC NULLS LAST, c.id',
};

const IN_SCOPE = SCOPED_CHANNELS.map((c) => `'${c}'`).join(',');

/**
 * Stands in for `customer_attribution`, narrowed to the in-scope channels and
 * exposed under the same `ca` alias so the sort expressions above still apply.
 */
const SCOPED_CTE = sql.raw(`
  WITH scoped_touch AS (
    SELECT DISTINCT ON (lt.customer_id)
           lt.customer_id, lt.channel, lt.campaign_id, lt.touched_at
    FROM   lead_touches lt
    WHERE  lt.channel IN (${IN_SCOPE})
    ORDER  BY lt.customer_id,
              lt.touched_at_is_estimated ASC,
              lt.touched_at ASC,
              CASE lt.channel WHEN 'meta' THEN 2 WHEN 'whatsapp' THEN 3 ELSE 4 END
  ),
  sale_agg AS (
    SELECT customer_id, COUNT(*) AS bill_count, SUM(bill_amount) AS total_sales,
           MIN(billed_at) AS first_sale_at
    FROM   sales WHERE customer_id IS NOT NULL GROUP BY customer_id
  ),
  ca AS (
    SELECT st.customer_id,
           st.channel AS primary_channel,
           st.touched_at AS first_touch_at,
           COALESCE(sa.bill_count, 0)::int      AS bill_count,
           COALESCE(sa.total_sales, 0)::numeric AS total_sales,
           sa.first_sale_at,
           (sa.customer_id IS NOT NULL)         AS converted
    FROM   scoped_touch st
    LEFT   JOIN sale_agg sa ON sa.customer_id = st.customer_id
  )`);

export async function getCustomers(filters: CustomerFilters): Promise<CustomerPage> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  const orderBy = SORTS[filters.sort ?? 'sales'] ?? SORTS.sales;

  // Parameterised throughout — never interpolate a search term into SQL.
  const conditions: SQL[] = [];

  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    conditions.push(
      sql`(c.full_name ILIKE ${term} OR c.email ILIKE ${term}
           OR c.phone_national LIKE ${term} OR c.city ILIKE ${term})`,
    );
  }
  if (filters.store) {
    // Billed store only — the walk-in submission branch went with that channel.
    conditions.push(sql`EXISTS (
      SELECT 1 FROM sales s2 JOIN stores st2 ON st2.id = s2.store_id
      WHERE s2.customer_id = c.id AND st2.code = ${filters.store})`);
  }
  if (filters.channel) {
    conditions.push(sql`ca.primary_channel = ${filters.channel}::channel`);
  }
  if (filters.lifecycle) {
    conditions.push(sql`c.lifecycle = ${filters.lifecycle}::lifecycle`);
  }
  if (filters.hasSales === 'yes') conditions.push(sql`ca.converted`);
  if (filters.hasSales === 'no') conditions.push(sql`NOT ca.converted`);

  const where = conditions.length
    ? sql.join([sql`WHERE `, sql.join(conditions, sql` AND `)])
    : sql``;

  const [countRow] = await query(sql`
    ${SCOPED_CTE}
    SELECT COUNT(*)::int AS n
    FROM   customers c
    JOIN   ca ON ca.customer_id = c.id
    ${where}`);
  const total = Number(countRow?.n ?? 0);

  const rows = await query(sql`
    ${SCOPED_CTE}
    SELECT
      c.id, c.phone_e164, c.full_name, c.email, c.area, c.city,
      c.date_of_birth::text AS date_of_birth,
      c.anniversary::text AS anniversary,
      c.lifecycle::text AS lifecycle,
      c.lifecycle_basis::text AS lifecycle_basis,
      ca.primary_channel::text AS primary_channel,
      ca.bill_count, ca.total_sales,
      ca.first_sale_at::text AS first_sale_at,
      ca.first_touch_at::text AS first_touch_at,
      st.name AS store_name,
      COALESCE((
        SELECT array_agg(DISTINCT lt.channel::text)
        FROM lead_touches lt
        WHERE lt.customer_id = c.id AND lt.channel IN (${sql.raw(IN_SCOPE)})), '{}') AS channels,
      COALESCE((
        SELECT array_agg(DISTINCT cp.name)
        FROM lead_touches lt JOIN campaigns cp ON cp.id = lt.campaign_id
        WHERE lt.customer_id = c.id AND lt.channel IN (${sql.raw(IN_SCOPE)})), '{}') AS campaigns,
      COALESCE((
        SELECT bool_or(lt.touched_at_is_estimated)
        FROM lead_touches lt
        WHERE lt.customer_id = c.id AND lt.channel IN (${sql.raw(IN_SCOPE)})), false) AS touch_estimated,
      (SELECT lf.final_remark::text FROM lead_followups lf
        JOIN lead_touches lt ON lt.id = lf.lead_touch_id
        WHERE lt.customer_id = c.id AND lt.channel IN (${sql.raw(IN_SCOPE)})
          AND lf.final_remark <> 'pending'
        ORDER BY lt.touched_at DESC LIMIT 1) AS final_remark,
      (SELECT lf.call1_made FROM lead_followups lf
        JOIN lead_touches lt ON lt.id = lf.lead_touch_id
        WHERE lt.customer_id = c.id AND lt.channel IN (${sql.raw(IN_SCOPE)})
        ORDER BY lt.touched_at DESC LIMIT 1) AS call1_made
    FROM   customers c
    JOIN   ca ON ca.customer_id = c.id
    LEFT   JOIN stores st ON st.id = c.preferred_store_id
    ${where}
    ORDER  BY ${sql.raw(orderBy)}
    LIMIT  ${pageSize} OFFSET ${offset}`);

  return {
    rows: rows.map((r) => ({
      id: Number(r.id),
      phoneE164: String(r.phone_e164),
      fullName: r.full_name ? String(r.full_name) : null,
      email: r.email ? String(r.email) : null,
      area: r.area ? String(r.area) : null,
      city: r.city ? String(r.city) : null,
      dateOfBirth: r.date_of_birth ? String(r.date_of_birth) : null,
      anniversary: r.anniversary ? String(r.anniversary) : null,
      storeName: r.store_name ? String(r.store_name) : null,
      lifecycle: String(r.lifecycle),
      lifecycleBasis: r.lifecycle_basis ? String(r.lifecycle_basis) : null,
      primaryChannel: r.primary_channel ? String(r.primary_channel) : null,
      channels: (r.channels as string[]) ?? [],
      campaigns: (r.campaigns as string[]) ?? [],
      billCount: Number(r.bill_count ?? 0),
      totalSales: Number(r.total_sales ?? 0),
      firstSaleAt: r.first_sale_at ? String(r.first_sale_at) : null,
      firstTouchAt: r.first_touch_at ? String(r.first_touch_at) : null,
      touchEstimated: Boolean(r.touch_estimated),
      finalRemark: r.final_remark ? String(r.final_remark) : null,
      call1Made: r.call1_made === null ? null : Boolean(r.call1_made),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getFilterOptions() {
  const stores = await query(sql`SELECT code, name FROM stores ORDER BY name`);
  // Only the in-scope channels are offered — a dropdown entry that returns an
  // empty table reads as a bug. (D-82)
  const channels = await query(sql`
    SELECT DISTINCT channel::text AS channel
    FROM   lead_touches
    WHERE  channel IN (${sql.raw(IN_SCOPE)})
    ORDER  BY 1`);
  return {
    stores: stores.map((s) => ({ code: String(s.code), name: String(s.name) })),
    channels: channels.map((c) => String(c.channel)),
  };
}
