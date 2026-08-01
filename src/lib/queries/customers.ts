/**
 * Customer table query.
 *
 * Server-side paginated and filtered — the browser never receives more than a
 * page. (D-78) Every filter composes; none silently clears another. (D-82)
 *
 * Each row carries all of its channel touches, not just the attributed one —
 * that is the whole payoff of keeping `lead_touches` append-only. (D-40, D-79)
 */

import { db } from '@/db';
import { sql, type SQL } from 'drizzle-orm';

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
  purposeOfVisit: string | null;
  howDidYouHear: string | null;
  finalRemark: string | null;
  call1Made: boolean | null;
  submissionCount: number;
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
    conditions.push(sql`EXISTS (
      SELECT 1 FROM sales s2 JOIN stores st2 ON st2.id = s2.store_id
      WHERE s2.customer_id = c.id AND st2.code = ${filters.store}
      UNION ALL
      SELECT 1 FROM walkin_submissions w2 JOIN stores st3 ON st3.id = w2.store_id
      WHERE w2.customer_id = c.id AND st3.code = ${filters.store})`);
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
    SELECT COUNT(*)::int AS n
    FROM   customers c
    JOIN   customer_attribution ca ON ca.customer_id = c.id
    ${where}`);
  const total = Number(countRow?.n ?? 0);

  const rows = await query(sql`
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
        FROM lead_touches lt WHERE lt.customer_id = c.id), '{}') AS channels,
      COALESCE((
        SELECT array_agg(DISTINCT cp.name)
        FROM lead_touches lt JOIN campaigns cp ON cp.id = lt.campaign_id
        WHERE lt.customer_id = c.id), '{}') AS campaigns,
      COALESCE((
        SELECT bool_or(lt.touched_at_is_estimated)
        FROM lead_touches lt WHERE lt.customer_id = c.id), false) AS touch_estimated,
      (SELECT w.purpose_of_visit FROM walkin_submissions w
        WHERE w.customer_id = c.id ORDER BY w.submitted_at DESC LIMIT 1) AS purpose_of_visit,
      (SELECT w.how_did_you_hear FROM walkin_submissions w
        WHERE w.customer_id = c.id ORDER BY w.submitted_at DESC LIMIT 1) AS how_did_you_hear,
      (SELECT COUNT(*)::int FROM walkin_submissions w WHERE w.customer_id = c.id) AS submission_count,
      (SELECT lf.final_remark::text FROM lead_followups lf
        JOIN lead_touches lt ON lt.id = lf.lead_touch_id
        WHERE lt.customer_id = c.id AND lf.final_remark <> 'pending'
        ORDER BY lt.touched_at DESC LIMIT 1) AS final_remark,
      (SELECT lf.call1_made FROM lead_followups lf
        JOIN lead_touches lt ON lt.id = lf.lead_touch_id
        WHERE lt.customer_id = c.id ORDER BY lt.touched_at DESC LIMIT 1) AS call1_made
    FROM   customers c
    JOIN   customer_attribution ca ON ca.customer_id = c.id
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
      purposeOfVisit: r.purpose_of_visit ? String(r.purpose_of_visit) : null,
      howDidYouHear: r.how_did_you_hear ? String(r.how_did_you_hear) : null,
      finalRemark: r.final_remark ? String(r.final_remark) : null,
      call1Made: r.call1_made === null ? null : Boolean(r.call1_made),
      submissionCount: Number(r.submission_count ?? 0),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getFilterOptions() {
  const stores = await query(sql`SELECT code, name FROM stores ORDER BY name`);
  const channels = await query(sql`
    SELECT DISTINCT primary_channel::text AS channel
    FROM customer_attribution WHERE primary_channel IS NOT NULL ORDER BY 1`);
  return {
    stores: stores.map((s) => ({ code: String(s.code), name: String(s.name) })),
    channels: channels.map((c) => String(c.channel)),
  };
}
