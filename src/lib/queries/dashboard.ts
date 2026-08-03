/**
 * Dashboard metric queries — every channel in the master sheet.
 *
 * The single definition of every KPI (D-76). Server Components and any future
 * REST route both read from here, so "conversion rate" cannot come to mean two
 * slightly different things in two places.
 *
 * ── Scope (D-86, reversing D-83) ────────────────────────────────────────────
 * All four master-sheet channels are reported: Meta, WhatsApp, Google Ads and
 * Others. D-83 had narrowed this view to the two digital sources to keep
 * store-sourced walk-ins out of the headline; the master sheet then dissolved
 * the walk-in channel and redistributed those people (D-84), so the narrowing
 * no longer excluded what it was written to exclude — it just hid Google Ads.
 *
 * The cost of the reversal is stated plainly, because it moves the headline a
 * long way: `other` is store-sourced and converts at 44.7%, against 7.8% for
 * Meta and 1.3% for WhatsApp. It is largely people who had already bought, so
 * blended conversion rises from 3.8% to 6.2% without any campaign performing
 * better. Read the channel table, not the headline rate, to judge acquisition.
 *
 * ── Why not read `customer_attribution` ─────────────────────────────────────
 * Two differences, both deliberate. That view relabels `primary_channel` to
 * 'existing' for anyone whose lifecycle is existing, which would empty the
 * channel rows of every lead who turned out to be a prior customer; and it
 * carries the 284 buyers who match no lead record at all, who are not leads and
 * do not belong in a lead denominator. First touch is therefore recomputed here
 * over `lead_touches`, using the same precedence rules as migration 0006.
 *
 * ── The denominator (D-46) ──────────────────────────────────────────────────
 * `totalLeads` counts every lead, including those already flagged as existing
 * customers, so the headline agrees with the channel table beneath it. The D-46
 * funnel figure — existing and foreign numbers excluded — is reported alongside
 * as `newLeads`/`newConverted`/`newRevenue`, never folded in.
 */

import { db } from '@/db';
import { sql } from 'drizzle-orm';

type Row = Record<string, unknown>;

async function query(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

/** The channels this dashboard reports on. (D-86) */
export const SCOPED_CHANNELS = ['google', 'meta', 'other', 'whatsapp'] as const;

const IN_SCOPE = SCOPED_CHANNELS.map((c) => `'${c}'`).join(',');

/**
 * First touch across the in-scope channels, with each person's sales attached.
 * Precedence matches `customer_attribution` (migration 0006): real timestamps
 * beat estimated ones, then earliest, then channel priority, then campaign id
 * so the order is total and never planner-dependent.
 *
 * The master sheet carries no dates at all, so every touch is estimated and
 * rule 1 never fires — channel priority decides every overlap, not just ties.
 * That ordering is `settings.channel_priority`; keep the two in step.
 */
const PRIORITY = `CASE lt.channel
              WHEN 'google'   THEN 1
              WHEN 'meta'     THEN 2
              WHEN 'other'    THEN 3
              WHEN 'whatsapp' THEN 4
              ELSE 5
            END`;

const SCOPED = `
  scoped_touch AS (
    SELECT DISTINCT ON (lt.customer_id)
           lt.customer_id, lt.channel, lt.campaign_id
    FROM   lead_touches lt
    WHERE  lt.channel IN (${IN_SCOPE})
    ORDER  BY lt.customer_id,
              lt.touched_at_is_estimated ASC,
              lt.touched_at ASC,
              ${PRIORITY},
              lt.campaign_id
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
  /** Business-wide, not scope-limited — existing customers have no lead touch. */
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
             COALESCE(SUM(total_sales) FILTER (WHERE in_funnel AND converted), 0)::numeric AS new_revenue
      FROM   scoped
    ),
    -- Existing customers are counted business-wide, not within lead scope.
    -- Sourcing them from the scoped CTE (as this once did) silently returned
    -- zero: every existing customer is no_lead_match, which is what makes them
    -- existing (D-36), so by definition none has a lead touch and none survives
    -- the join. The tile read "0 buyers of 0" while the data-quality panel
    -- simultaneously reported their 79,20,018.
    -- No double count: in_funnel excludes lifecycle = 'existing', so the new and
    -- existing segments are disjoint and sum with phone-less to gross (D-50).
    existing AS (
      SELECT COUNT(*)::int                                   AS existing_people,
             COUNT(*) FILTER (WHERE converted)::int          AS existing_buyers,
             COALESCE(SUM(total_sales), 0)::numeric          AS existing_revenue
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
    SELECT a.*, e.*, b.n, b.gross, b.phoneless_n, b.phoneless_rev
    FROM   agg a, existing e, bills b`);

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
      // Campaign names are prefixed by their source: "Master Sheet — Meta",
      // "Varamahalakshmi — WhatsApp Broadcast". The prefix is constant within a
      // load, so it carries no information in a table already grouped by it.
      name: String(r.name).replace(/^(Master Sheet|Varamahalakshmi) — /, ''),
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
  /** Distinct phone keys per channel, before first touch picks a winner. */
  perChannel: { channel: string; phones: number }[];
  onMoreThanOneList: number;
  unionPhones: number;
  matchedInSales: number;
}

/**
 * Raw phone-key reach, before first touch picks a winner. `onMoreThanOneList`
 * is why the channel rows above cannot simply be added — those people are
 * counted once each there, under whichever channel priority awarded them.
 */
export async function getReach(): Promise<Reach> {
  const perChannel = await query(`
    SELECT channel::text AS channel, COUNT(DISTINCT customer_id)::int AS phones
    FROM   lead_touches
    WHERE  channel IN (${IN_SCOPE})
    GROUP  BY 1 ORDER BY phones DESC`);

  const [row] = await query(`
    WITH u AS (
      SELECT customer_id, COUNT(DISTINCT channel)::int AS n
      FROM   lead_touches WHERE channel IN (${IN_SCOPE})
      GROUP  BY customer_id
    )
    SELECT (SELECT COUNT(*)::int FROM u)                AS union_n,
           (SELECT COUNT(*)::int FROM u WHERE n > 1)    AS multi,
           (SELECT COUNT(*)::int FROM u
             WHERE EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = u.customer_id)) AS matched`);

  return {
    perChannel: perChannel.map((r) => ({
      channel: String(r.channel),
      phones: Number(r.phones ?? 0),
    })),
    onMoreThanOneList: Number(row.multi ?? 0),
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
 * Billed revenue per branch, and the share traceable to a master-sheet lead.
 * The walk-in submission count that used to sit here went with that channel.
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

/**
 * Tele-calling outcomes. Empty since the master-sheet load (D-84): the workbook
 * carries no call outcomes, and the follow-up rows that did exist belonged to
 * the per-channel exports it replaced. Returns [] until a dated export restores
 * them — the caller renders nothing rather than a row of zeroes.
 */
export async function getFollowupOutcomes(): Promise<FollowupRow[]> {
  const rows = await query(`
    SELECT lf.final_remark::text AS remark, COUNT(*)::int AS n
    FROM   lead_followups lf
    JOIN   lead_touches lt ON lt.id = lf.lead_touch_id
    WHERE  lt.channel IN (${IN_SCOPE})
    GROUP  BY 1 ORDER BY n DESC`);
  return rows.map((r) => ({ remark: String(r.remark), n: Number(r.n ?? 0) }));
}
