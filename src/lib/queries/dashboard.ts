/**
 * Dashboard metric queries — Instagram and WhatsApp only.
 *
 * The single definition of every KPI (D-76). Server Components and any future
 * REST route both read from here, so "conversion rate" cannot come to mean two
 * slightly different things in two places.
 *
 * ── Scope (D-83) ────────────────────────────────────────────────────────────
 * This dashboard reports the two digital lead sources. Walk-in is out of scope:
 * it is not queried, not counted and not plotted.
 *
 * Scoping is a *filter*, not a deletion. Nothing in `lead_touches` or
 * `walkin_submissions` is removed, for one reason worth stating: the walk-in
 * form is the only evidence that 16 of the 100 matched buyers were already
 * customers (`lifecycle_basis = 'self_declared'`). Delete it and
 * `recompute_customer_lifecycle()` silently reclassifies those people as new
 * acquisitions, inflating Instagram's converted count from 72 to 85 with no
 * remaining trace of the error. The rows stay; the view narrows.
 *
 * ── Why not read `customer_attribution` ─────────────────────────────────────
 * That materialized view resolves first touch across *all* channels, so a
 * person reached on Instagram who later filled a walk-in form is credited to
 * walk-in (migration 0005 — a real timestamp outranks an estimated one).
 * Filtering its `primary_channel` to meta/whatsapp would therefore silently
 * drop 82 Instagram and 196 WhatsApp leads that walk-in had taken. With walk-in
 * out of scope those people are back in play, so first touch is recomputed here
 * over the two digital channels alone, using the same precedence rules.
 *
 * ── The denominator (D-46) ──────────────────────────────────────────────────
 * `totalLeads` here counts every digital lead, including the 25 already flagged
 * as existing customers, so the headline agrees with the channel table beneath
 * it. The D-46 funnel figure — existing and foreign numbers excluded — is
 * reported alongside as `newLeads`/`newConverted`/`newRevenue`, never folded in.
 */

import { db } from '@/db';
import { sql } from 'drizzle-orm';

type Row = Record<string, unknown>;

async function query(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

/** The only channels this dashboard reports on. */
export const SCOPED_CHANNELS = ['meta', 'whatsapp'] as const;

const IN_SCOPE = SCOPED_CHANNELS.map((c) => `'${c}'`).join(',');

/**
 * First touch across the in-scope channels only, with each person's sales
 * attached. Precedence matches `customer_attribution` (migration 0005):
 * real timestamps beat estimated ones, then earliest, then channel priority.
 *
 * Both digital sources are wholly estimated (neither export carries a per-lead
 * date), so in practice rule 1 never fires here and ties fall to channel
 * priority — Instagram outranks WhatsApp, per the `channel_priority` setting.
 */
const SCOPED = `
  scoped_touch AS (
    SELECT DISTINCT ON (lt.customer_id)
           lt.customer_id, lt.channel, lt.campaign_id
    FROM   lead_touches lt
    WHERE  lt.channel IN (${IN_SCOPE})
    ORDER  BY lt.customer_id,
              lt.touched_at_is_estimated ASC,
              lt.touched_at ASC,
              CASE lt.channel WHEN 'meta' THEN 2 WHEN 'whatsapp' THEN 3 ELSE 4 END
  ),
  sale_agg AS (
    SELECT customer_id,
           COUNT(*)           AS bill_count,
           SUM(bill_amount)   AS total_sales
    FROM   sales
    WHERE  customer_id IS NOT NULL
    GROUP  BY customer_id
  ),
  scoped AS (
    SELECT st.customer_id,
           st.channel::text            AS channel,
           st.campaign_id,
           c.lifecycle::text           AS lifecycle,
           c.lifecycle_basis::text     AS lifecycle_basis,
           COALESCE(sa.bill_count, 0)::int      AS bill_count,
           COALESCE(sa.total_sales, 0)::numeric AS total_sales,
           (sa.customer_id IS NOT NULL)         AS converted,
           (c.lifecycle <> 'existing' AND NOT c.is_foreign) AS in_funnel
    FROM   scoped_touch st
    JOIN   customers c ON c.id = st.customer_id
    LEFT   JOIN sale_agg sa ON sa.customer_id = st.customer_id
  )
`;

export interface Kpis {
  /** Every in-scope lead, existing customers included. */
  totalLeads: number;
  leadsConverted: number;
  conversionRate: number;
  /** Revenue from in-scope leads who bought. */
  attributedRevenue: number;
  attributedBills: number;
  /** D-46 funnel: existing and foreign numbers excluded. */
  newLeads: number;
  newConverted: number;
  newRevenue: number;
  existingPeople: number;
  existingBuyers: number;
  existingRevenue: number;
  /** Whole-business context — not limited to the in-scope channels. */
  grossSales: number;
  totalBills: number;
  phonelessBills: number;
  phonelessRevenue: number;
}

export async function getKpis(): Promise<Kpis> {
  const [row] = await query(`
    WITH ${SCOPED},
    agg AS (
      SELECT COUNT(*)::int                                        AS leads,
             COUNT(*) FILTER (WHERE converted)::int               AS converted,
             COALESCE(SUM(total_sales) FILTER (WHERE converted), 0)::numeric AS revenue,
             COALESCE(SUM(bill_count), 0)::int                    AS bills,
             COUNT(*) FILTER (WHERE in_funnel)::int               AS new_leads,
             COUNT(*) FILTER (WHERE in_funnel AND converted)::int AS new_converted,
             COALESCE(SUM(total_sales) FILTER (WHERE in_funnel AND converted), 0)::numeric AS new_revenue,
             COUNT(*) FILTER (WHERE lifecycle = 'existing')::int  AS existing_people,
             COUNT(*) FILTER (WHERE lifecycle = 'existing' AND converted)::int AS existing_buyers,
             COALESCE(SUM(total_sales) FILTER (WHERE lifecycle = 'existing'), 0)::numeric AS existing_revenue
      FROM   scoped
    ),
    bills AS (
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(bill_amount), 0)::numeric AS gross,
             COUNT(*) FILTER (WHERE customer_id IS NULL)::int AS phoneless_n,
             COALESCE(SUM(bill_amount) FILTER (WHERE customer_id IS NULL), 0)::numeric AS phoneless_rev
      FROM   sales
    )
    SELECT a.*, b.n, b.gross, b.phoneless_n, b.phoneless_rev
    FROM   agg a, bills b`);

  const leads = Number(row.leads ?? 0);
  const converted = Number(row.converted ?? 0);

  return {
    totalLeads: leads,
    leadsConverted: converted,
    conversionRate: leads ? (100 * converted) / leads : 0,
    attributedRevenue: Number(row.revenue ?? 0),
    attributedBills: Number(row.bills ?? 0),
    newLeads: Number(row.new_leads ?? 0),
    newConverted: Number(row.new_converted ?? 0),
    newRevenue: Number(row.new_revenue ?? 0),
    existingPeople: Number(row.existing_people ?? 0),
    existingBuyers: Number(row.existing_buyers ?? 0),
    existingRevenue: Number(row.existing_revenue ?? 0),
    grossSales: Number(row.gross ?? 0),
    totalBills: Number(row.n ?? 0),
    phonelessBills: Number(row.phoneless_n ?? 0),
    phonelessRevenue: Number(row.phoneless_rev ?? 0),
  };
}

export interface ChannelRow {
  channel: string;
  people: number;
  buyers: number;
  conversionRate: number;
  revenue: number;
  bills: number;
  /** D-46 funnel figures for the same channel. */
  funnelPeople: number;
  funnelBuyers: number;
  funnelConversionRate: number;
  funnelRevenue: number;
}

/** Exclusive first-touch split — these rows sum exactly to the KPI totals. */
export async function getChannelBreakdown(): Promise<ChannelRow[]> {
  const rows = await query(`
    WITH ${SCOPED}
    SELECT channel,
           COUNT(*)::int                          AS people,
           COUNT(*) FILTER (WHERE converted)::int AS buyers,
           COALESCE(SUM(total_sales) FILTER (WHERE converted), 0)::numeric AS revenue,
           COALESCE(SUM(bill_count), 0)::int      AS bills,
           COUNT(*) FILTER (WHERE in_funnel)::int AS funnel_people,
           COUNT(*) FILTER (WHERE in_funnel AND converted)::int AS funnel_buyers,
           COALESCE(SUM(total_sales) FILTER (WHERE in_funnel AND converted), 0)::numeric AS funnel_revenue
    FROM   scoped
    GROUP  BY channel
    ORDER  BY people DESC`);

  return rows.map((r) => {
    const people = Number(r.people ?? 0);
    const buyers = Number(r.buyers ?? 0);
    const funnelPeople = Number(r.funnel_people ?? 0);
    const funnelBuyers = Number(r.funnel_buyers ?? 0);
    return {
      channel: String(r.channel),
      people,
      buyers,
      conversionRate: people ? (100 * buyers) / people : 0,
      revenue: Number(r.revenue ?? 0),
      bills: Number(r.bills ?? 0),
      funnelPeople,
      funnelBuyers,
      funnelConversionRate: funnelPeople ? (100 * funnelBuyers) / funnelPeople : 0,
      funnelRevenue: Number(r.funnel_revenue ?? 0),
    };
  });
}

export interface CampaignRow {
  name: string;
  channel: string;
  people: number;
  buyers: number;
  conversionRate: number;
  revenue: number;
  revenuePerLead: number;
}

/** The campaign-level split beneath each channel. */
export async function getCampaignBreakdown(): Promise<CampaignRow[]> {
  const rows = await query(`
    WITH ${SCOPED}
    SELECT cp.name,
           s.channel,
           COUNT(*)::int                            AS people,
           COUNT(*) FILTER (WHERE s.converted)::int AS buyers,
           COALESCE(SUM(s.total_sales) FILTER (WHERE s.converted), 0)::numeric AS revenue
    FROM   scoped s
    JOIN   campaigns cp ON cp.id = s.campaign_id
    GROUP  BY cp.name, s.channel
    ORDER  BY revenue DESC`);

  return rows.map((r) => {
    const people = Number(r.people ?? 0);
    const buyers = Number(r.buyers ?? 0);
    const revenue = Number(r.revenue ?? 0);
    return {
      name: String(r.name).replace('Varamahalakshmi — ', ''),
      channel: String(r.channel),
      people,
      buyers,
      conversionRate: people ? (100 * buyers) / people : 0,
      revenue,
      revenuePerLead: people ? revenue / people : 0,
    };
  });
}

export interface Reach {
  instagramPhones: number;
  whatsappPhones: number;
  inBoth: number;
  unionPhones: number;
  matchedInSales: number;
}

/**
 * Raw phone-key reach, before first touch picks a winner. `inBoth` is why the
 * two channel rows cannot simply be added: 198 people are on both lists.
 */
export async function getReach(): Promise<Reach> {
  const [row] = await query(`
    WITH m AS (SELECT DISTINCT customer_id FROM lead_touches WHERE channel = 'meta'),
         w AS (SELECT DISTINCT customer_id FROM lead_touches WHERE channel = 'whatsapp'),
         u AS (SELECT customer_id FROM m UNION SELECT customer_id FROM w)
    SELECT (SELECT COUNT(*)::int FROM m) AS insta,
           (SELECT COUNT(*)::int FROM w) AS wa,
           (SELECT COUNT(*)::int FROM m JOIN w USING (customer_id)) AS both,
           (SELECT COUNT(*)::int FROM u) AS union_n,
           (SELECT COUNT(*)::int FROM u
             WHERE EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = u.customer_id)) AS matched`);

  return {
    instagramPhones: Number(row.insta ?? 0),
    whatsappPhones: Number(row.wa ?? 0),
    inBoth: Number(row.both ?? 0),
    unionPhones: Number(row.union_n ?? 0),
    matchedInSales: Number(row.matched ?? 0),
  };
}

export interface StoreRow {
  code: string;
  name: string;
  voucherPrefix: string | null;
  bills: number;
  revenue: number;
  /** Bills from in-scope leads only. */
  attributedBills: number;
  attributedRevenue: number;
}

/**
 * Billed revenue per branch. The walk-in submission count that used to sit here
 * is gone with the rest of that channel; the in-scope columns replace it.
 */
export async function getStoreBreakdown(): Promise<StoreRow[]> {
  const rows = await query(`
    WITH scoped_customers AS (
      SELECT DISTINCT customer_id FROM lead_touches WHERE channel IN (${IN_SCOPE})
    )
    SELECT st.code, st.name, st.voucher_prefix,
           COUNT(s.id)::int AS bills,
           COALESCE(SUM(s.bill_amount), 0)::numeric AS revenue,
           COUNT(s.id) FILTER (WHERE sc.customer_id IS NOT NULL)::int AS attr_bills,
           COALESCE(SUM(s.bill_amount) FILTER (WHERE sc.customer_id IS NOT NULL), 0)::numeric AS attr_revenue
    FROM   stores st
    LEFT   JOIN sales s ON s.store_id = st.id
    LEFT   JOIN scoped_customers sc ON sc.customer_id = s.customer_id
    GROUP  BY st.id, st.code, st.name, st.voucher_prefix
    ORDER  BY revenue DESC`);

  return rows.map((r) => ({
    code: String(r.code),
    name: String(r.name),
    voucherPrefix: r.voucher_prefix ? String(r.voucher_prefix) : null,
    bills: Number(r.bills ?? 0),
    revenue: Number(r.revenue ?? 0),
    attributedBills: Number(r.attr_bills ?? 0),
    attributedRevenue: Number(r.attr_revenue ?? 0),
  }));
}

export interface DataQuality {
  rejectedUnresolved: number;
  rejectsByCode: { code: string; n: number }[];
  phonelessBills: number;
  phonelessRevenue: number;
  /** Buyers with a phone key that matches no in-scope lead. */
  unmatchedBuyers: number;
  unmatchedBuyerRevenue: number;
  estimatedTouches: number;
  scopedTouches: number;
}

/**
 * The gaps, shown rather than smoothed over. Every one of these silently
 * distorts a KPI if it goes unmentioned. (D-56) Rejects are counted from the
 * in-scope import batches only.
 */
export async function getDataQuality(): Promise<DataQuality> {
  const [row] = await query(`
    WITH scoped_customers AS (
      SELECT DISTINCT customer_id FROM lead_touches WHERE channel IN (${IN_SCOPE})
    )
    SELECT
      (SELECT COUNT(*)::int FROM import_rows_rejected r
        JOIN import_batches b ON b.id = r.batch_id
        WHERE NOT r.resolved AND b.source_type IN (${IN_SCOPE})) AS rejected,
      (SELECT COUNT(*)::int FROM sales WHERE customer_id IS NULL) AS phoneless_n,
      (SELECT COALESCE(SUM(bill_amount),0)::numeric FROM sales WHERE customer_id IS NULL) AS phoneless_rev,
      (SELECT COUNT(DISTINCT s.customer_id)::int FROM sales s
        WHERE s.customer_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM scoped_customers sc WHERE sc.customer_id = s.customer_id)) AS unmatched_n,
      (SELECT COALESCE(SUM(s.bill_amount),0)::numeric FROM sales s
        WHERE s.customer_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM scoped_customers sc WHERE sc.customer_id = s.customer_id)) AS unmatched_rev,
      (SELECT COUNT(*)::int FROM lead_touches
        WHERE channel IN (${IN_SCOPE}) AND touched_at_is_estimated) AS estimated,
      (SELECT COUNT(*)::int FROM lead_touches WHERE channel IN (${IN_SCOPE})) AS scoped_touches`);

  const codes = await query(`
    SELECT r.error_code, COUNT(*)::int AS n
    FROM   import_rows_rejected r
    JOIN   import_batches b ON b.id = r.batch_id
    WHERE  NOT r.resolved AND b.source_type IN (${IN_SCOPE})
    GROUP  BY 1 ORDER BY n DESC`);

  return {
    rejectedUnresolved: Number(row.rejected ?? 0),
    rejectsByCode: codes.map((c) => ({ code: String(c.error_code), n: Number(c.n ?? 0) })),
    phonelessBills: Number(row.phoneless_n ?? 0),
    phonelessRevenue: Number(row.phoneless_rev ?? 0),
    unmatchedBuyers: Number(row.unmatched_n ?? 0),
    unmatchedBuyerRevenue: Number(row.unmatched_rev ?? 0),
    estimatedTouches: Number(row.estimated ?? 0),
    scopedTouches: Number(row.scoped_touches ?? 0),
  };
}

export interface FollowupRow {
  remark: string;
  n: number;
}

/** Tele-calling outcomes — Instagram sheets only; WhatsApp carries no follow-up. */
export async function getFollowupOutcomes(): Promise<FollowupRow[]> {
  const rows = await query(`
    SELECT lf.final_remark::text AS remark, COUNT(*)::int AS n
    FROM   lead_followups lf
    JOIN   lead_touches lt ON lt.id = lf.lead_touch_id
    WHERE  lt.channel IN (${IN_SCOPE})
    GROUP  BY 1 ORDER BY n DESC`);
  return rows.map((r) => ({ remark: String(r.remark), n: Number(r.n ?? 0) }));
}
