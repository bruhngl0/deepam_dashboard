/**
 * Customer table query — every channel in the master sheet.
 *
 * Server-side paginated and filtered — the browser never receives more than a
 * page. (D-78) Every filter composes; none silently clears another. (D-82)
 *
 * Each row carries all of its channel touches, not just the attributed one —
 * that is the payoff of keeping `lead_touches` append-only. (D-40, D-79)
 *
 * Scope (D-86): only people with at least one lead touch are listed, so the 284
 * buyers who match no lead record do not appear here — they are counted in the
 * existing-customer tiles instead. The walk-in-derived columns went with that
 * channel. First touch is recomputed rather than read from
 * `customer_attribution`, for the reason set out in `dashboard.ts`.
 *
 * `valueTier` is the one field on this row that is *not* scoped to leads —
 * it is the same business-wide ranking `dashboard.ts` computes for the
 * Customer value panel (`VALUE_TIER`), joined in here so a lead can be
 * filtered and labelled by how much they are actually worth, not just
 * whether they converted.
 *
 * `from`/`to` bound `bill_count`/`total_sales`/`converted`/`first_sale_at`
 * to sales within the window, the same date range the dashboard tiles use —
 * so a filtered customer table and the KPI row above it always describe the
 * same period.
 */

import { db } from '@/db';
import { sql, type SQL } from 'drizzle-orm';
import {
  SCOPED_CHANNELS,
  VALUE_TIER,
  WINDOW_DAYS_EXPR,
  dateCondition,
  type DateRange,
  type ValueTierCode,
} from './dashboard';

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
  tier?: ValueTierCode;
  /** Bounds `ca.bill_count`/`total_sales`/`converted` to sales in this window. */
  from?: string | null;
  to?: string | null;
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
  valueTier: ValueTierCode;
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
 *
 * Built fresh per call, like `dashboard.ts`'s `buildScoped`, so `sale_agg` can
 * carry both bounds: `bill_count`/`total_sales`/`converted`/`first_sale_at` all
 * narrow to sales inside [touched_at, touched_at + attribution window) — the
 * same rule migration 0007 enforces in `customer_attribution` — further
 * narrowed to `range` if one is given. `value_tier` stays lifetime regardless
 * of either bound, for the reason documented on `VALUE_TIER` in dashboard.ts.
 */
function buildScopedCte(range: DateRange = {}) {
  return sql.raw(`
  WITH scoped_touch AS (
    SELECT DISTINCT ON (lt.customer_id)
           lt.customer_id, lt.channel, lt.campaign_id, lt.touched_at
    FROM   lead_touches lt
    WHERE  lt.channel IN (${IN_SCOPE})
    ORDER  BY lt.customer_id,
              lt.touched_at_is_estimated ASC,
              lt.touched_at ASC,
              CASE lt.channel
                WHEN 'google'   THEN 1
                WHEN 'meta'     THEN 2
                WHEN 'other'    THEN 3
                WHEN 'whatsapp' THEN 4
                ELSE 5
              END,
              lt.campaign_id
  ),
  sale_agg AS (
    SELECT s.customer_id, COUNT(*) AS bill_count, SUM(s.bill_amount) AS total_sales,
           MIN(s.billed_at) AS first_sale_at
    FROM   sales s
    JOIN   scoped_touch st ON st.customer_id = s.customer_id
    WHERE  s.customer_id IS NOT NULL
      AND  s.billed_at >= st.touched_at
      AND  s.billed_at < st.touched_at + (${WINDOW_DAYS_EXPR} * INTERVAL '1 day')${dateCondition('s', range)}
    GROUP  BY s.customer_id
  ),
  ${VALUE_TIER},
  ca AS (
    SELECT st.customer_id,
           st.channel AS primary_channel,
           st.touched_at AS first_touch_at,
           COALESCE(sa.bill_count, 0)::int      AS bill_count,
           COALESCE(sa.total_sales, 0)::numeric AS total_sales,
           sa.first_sale_at,
           (sa.customer_id IS NOT NULL)         AS converted,
           -- value_tier is business-wide (dashboard.ts), so it always matches:
           -- every id in scoped_touch also has a row in customer_attribution.
           vt.tier                              AS value_tier
    FROM   scoped_touch st
    LEFT   JOIN sale_agg sa ON sa.customer_id = st.customer_id
    LEFT   JOIN value_tier vt ON vt.customer_id = st.customer_id
  )`);
}

/**
 * Every non-pagination filter, shared between the paginated table
 * (`getCustomers`) and the unpaginated export (`getCustomersForExport`) — one
 * definition of "which customers match", so the CSV a manager downloads can
 * never quietly disagree with the table they downloaded it from.
 *
 * Parameterised throughout — never interpolate a search term into SQL.
 */
function buildConditions(filters: CustomerFilters): SQL[] {
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
    // Deliberately lifetime, not bounded by filters.from/to: "shopped at this
    // branch" is a fact about the person, and a date range narrowing which
    // sales count toward their totals shouldn't also make them vanish from a
    // store filter because their one visit happened to fall outside it.
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
  if (filters.tier) conditions.push(sql`ca.value_tier = ${filters.tier}`);

  return conditions;
}

function buildWhere(conditions: SQL[]): SQL {
  return conditions.length
    ? sql.join([sql`WHERE `, sql.join(conditions, sql` AND `)])
    : sql``;
}

export async function getCustomers(filters: CustomerFilters): Promise<CustomerPage> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 25));
  const offset = (page - 1) * pageSize;
  const orderBy = SORTS[filters.sort ?? 'sales'] ?? SORTS.sales;
  const SCOPED_CTE = buildScopedCte({ from: filters.from, to: filters.to });
  const where = buildWhere(buildConditions(filters));

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
      ca.value_tier,
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
      valueTier: (r.value_tier as ValueTierCode | null) ?? 'none',
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

/**
 * Every matching row, for CSV export — the same filters as `getCustomers`,
 * same `buildConditions`, no pagination. Capped well above the current 6,150
 * customers so today's export can never be silently truncated, but still
 * bounded rather than unconditionally unbounded — a filter mistake shouldn't
 * be able to turn into an unbounded query against a growing table.
 */
const EXPORT_ROW_CAP = 50_000;

export async function getCustomersForExport(
  filters: Omit<CustomerFilters, 'page' | 'pageSize'>,
): Promise<CustomerRow[]> {
  const orderBy = SORTS[filters.sort ?? 'sales'] ?? SORTS.sales;
  const SCOPED_CTE = buildScopedCte({ from: filters.from, to: filters.to });
  const where = buildWhere(buildConditions(filters));

  const rows = await query(sql`
    ${SCOPED_CTE}
    SELECT
      c.id, c.phone_e164, c.full_name, c.email, c.area, c.city,
      c.date_of_birth::text AS date_of_birth,
      c.anniversary::text AS anniversary,
      c.lifecycle::text AS lifecycle,
      c.lifecycle_basis::text AS lifecycle_basis,
      ca.primary_channel::text AS primary_channel,
      ca.value_tier,
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
    LIMIT  ${EXPORT_ROW_CAP}`);

  return rows.map((r) => ({
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
    valueTier: (r.value_tier as ValueTierCode | null) ?? 'none',
    channels: (r.channels as string[]) ?? [],
    campaigns: (r.campaigns as string[]) ?? [],
    billCount: Number(r.bill_count ?? 0),
    totalSales: Number(r.total_sales ?? 0),
    firstSaleAt: r.first_sale_at ? String(r.first_sale_at) : null,
    firstTouchAt: r.first_touch_at ? String(r.first_touch_at) : null,
    touchEstimated: Boolean(r.touch_estimated),
    finalRemark: r.final_remark ? String(r.final_remark) : null,
    call1Made: r.call1_made === null ? null : Boolean(r.call1_made),
  }));
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
