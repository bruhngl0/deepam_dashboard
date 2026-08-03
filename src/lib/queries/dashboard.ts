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
import { VALUE_TIER_LABEL, VALUE_TIER_ORDER, type ValueTierCode } from '@/lib/format';

type Row = Record<string, unknown>;

async function query(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

/** The channels this dashboard reports on. (D-86) */
export const SCOPED_CHANNELS = ['google', 'meta', 'other', 'whatsapp'] as const;

const IN_SCOPE = SCOPED_CHANNELS.map((c) => `'${c}'`).join(',');

/**
 * A period filter on `sales.billed_at`, both ends inclusive and both optional.
 * `null` on either side means unbounded on that side — the default is fully
 * unbounded, so adding this filter changes nothing until someone picks a date.
 *
 * Not every query takes a `DateRange`. `getCustomerValueTiers` deliberately
 * does not: a customer's value tier is a lifetime ranking, and re-ranking it
 * inside an arbitrarily short window (a single day, say) would make tier
 * membership shift in ways a filter control can't explain in one line. Lead
 * counts and touch-based queries (`getListOverlap`, `getFollowupOutcomes`)
 * don't take one either — the master sheet carries no per-lead dates (D-84),
 * so there is nothing on that side to bound.
 */
export interface DateRange {
  from?: string | null;
  to?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The only gate a date string passes through before it is ever interpolated
 * into raw SQL. Every query in this module builds its WHERE clauses as plain
 * strings (see `query()` above), so this — not the caller — is the actual
 * injection boundary: reject anything that isn't exactly `YYYY-MM-DD` and a
 * real calendar date, and return `null` rather than throw, so a malformed
 * value in a stale bookmark just drops the bound instead of erroring the page.
 */
export function parseDateParam(value: string | null | undefined): string | null {
  if (!value || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : value;
}

/**
 * `AND <alias>.billed_at ...` fragment for the given range, or `''` when both
 * ends are unbounded. `to` bounds against the *next* day rather than a bare
 * `<=`, because `billed_at` is a timestamp and a same-day comparison would
 * silently drop that day's afternoon bills.
 */
export function dateCondition(alias: string, range: DateRange): string {
  const from = parseDateParam(range.from);
  const to = parseDateParam(range.to);
  const parts: string[] = [];
  if (from) parts.push(`${alias}.billed_at >= '${from}'`);
  if (to) parts.push(`${alias}.billed_at < ('${to}'::date + interval '1 day')`);
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

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

/**
 * The attribution window (D-45, migration 0007), read from `settings` at
 * query time rather than hardcoded — unlike `PRIORITY` above, this value has
 * exactly one meaning everywhere it's read, so there is nothing to keep "in
 * step" by duplicating it; the query can just point at the row.
 */
export const WINDOW_DAYS_EXPR =
  `(SELECT (value #>> '{}')::int FROM settings WHERE key = 'attribution_window_days')`;

/**
 * `scoped_touch`/`sale_agg`/`scoped`, built fresh per call so `sale_agg` can
 * carry both bounds. `bill_count`/`total_sales`/`converted` count only sales
 * inside [touched_at, touched_at + window) — the same rule migration 0007
 * enforces in `customer_attribution` — further narrowed to `range` if one is
 * given. `scoped_touch` itself carries neither bound: leads have no date to
 * window at all (D-84), and existing customers never reach this CTE in the
 * first place (they have no lead touch, D-36), so the existing-customer
 * exemption that matters in the materialized view has nothing to exempt here.
 */
function buildScoped(range: DateRange = {}): string {
  return `
  scoped_touch AS (
    SELECT DISTINCT ON (lt.customer_id)
           lt.customer_id, lt.channel, lt.campaign_id, lt.touched_at
    FROM   lead_touches lt
    WHERE  lt.channel IN (${IN_SCOPE})
    ORDER  BY lt.customer_id,
              lt.touched_at_is_estimated ASC,
              lt.touched_at ASC,
              ${PRIORITY},
              lt.campaign_id
  ),
  sale_agg AS (
    SELECT s.customer_id,
           COUNT(*)             AS bill_count,
           SUM(s.bill_amount)   AS total_sales
    FROM   sales s
    JOIN   scoped_touch st ON st.customer_id = s.customer_id
    WHERE  s.customer_id IS NOT NULL
      AND  s.billed_at >= st.touched_at
      AND  s.billed_at < st.touched_at + (${WINDOW_DAYS_EXPR} * INTERVAL '1 day')${dateCondition('s', range)}
    GROUP  BY s.customer_id
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
}

export interface SalesDateBounds {
  earliest: string | null;
  latest: string | null;
}

/** The full range currently loaded — used to seed the date pickers' min/max. */
export async function getSalesDateBounds(): Promise<SalesDateBounds> {
  const [row] = await query(`SELECT MIN(billed_at)::date::text AS lo, MAX(billed_at)::date::text AS hi FROM sales`);
  return { earliest: (row?.lo as string) ?? null, latest: (row?.hi as string) ?? null };
}

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
  existingBills: number;
  /** Whole-business context — not limited to the in-scope channels. */
  grossSales: number;
  totalBills: number;
  phonelessBills: number;
  phonelessRevenue: number;
}

export async function getKpis(range: DateRange = {}): Promise<Kpis> {
  const [row] = await query(`
    WITH ${buildScoped(range)},
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
    -- Existing customers are counted business-wide, not within lead scope, and
    -- read live from customers/sales rather than from customer_attribution.
    -- Two reasons, not one. First: sourcing them from the scoped CTE (as this
    -- once did) silently returned zero -- every existing customer is
    -- no_lead_match, which is what makes them existing (D-36), so by
    -- definition none has a lead touch and none survives that join. Second:
    -- customer_attribution.total_sales is a materialized lifetime figure and
    -- cannot be windowed by the selected range without a live rebuild, so once
    -- a date range is selected it would drift out of step with the
    -- newly-windowed new_revenue above and silently break the reconciliation
    -- this tile promises on screen. existing_people is the one field here that
    -- stays a headcount regardless of range -- a person doesn't stop being an
    -- existing customer because their bill falls outside the selected window.
    -- No double count: in_funnel excludes lifecycle = 'existing', so the new and
    -- existing segments are disjoint and sum with phone-less to gross (D-50).
    existing AS (
      SELECT
        (SELECT COUNT(*)::int FROM customers WHERE lifecycle = 'existing') AS existing_people,
        COUNT(DISTINCT s.customer_id)::int      AS existing_buyers,
        COALESCE(SUM(s.bill_amount), 0)::numeric AS existing_revenue,
        COUNT(s.id)::int                        AS existing_bills
      FROM   sales s
      JOIN   customers c ON c.id = s.customer_id AND c.lifecycle = 'existing'
      WHERE  s.customer_id IS NOT NULL${dateCondition('s', range)}
    ),
    bills AS (
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(bill_amount), 0)::numeric AS gross,
             COUNT(*) FILTER (WHERE customer_id IS NULL)::int AS phoneless_n,
             COALESCE(SUM(bill_amount) FILTER (WHERE customer_id IS NULL), 0)::numeric AS phoneless_rev
      FROM   sales
      WHERE  true${dateCondition('sales', range)}
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
    existingBills: Number(row.existing_bills ?? 0),
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
  /** revenue / bills. A high conversion rate can still mean a low-value sale. */
  averageBill: number;
  /** revenue / buyers. The number that answers "was this channel worth it". */
  revenuePerBuyer: number;
  /** D-46 funnel figures for the same channel. */
  funnelPeople: number;
  funnelBuyers: number;
  funnelConversionRate: number;
  funnelRevenue: number;
}

/** Exclusive first-touch split — these rows sum exactly to the KPI totals. */
export async function getChannelBreakdown(range: DateRange = {}): Promise<ChannelRow[]> {
  const rows = await query(`
    WITH ${buildScoped(range)}
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
    const revenue = Number(r.revenue ?? 0);
    const bills = Number(r.bills ?? 0);
    const funnelPeople = Number(r.funnel_people ?? 0);
    const funnelBuyers = Number(r.funnel_buyers ?? 0);
    return {
      channel: String(r.channel),
      people,
      buyers,
      conversionRate: people ? (100 * buyers) / people : 0,
      revenue,
      bills,
      averageBill: bills ? revenue / bills : 0,
      revenuePerBuyer: buyers ? revenue / buyers : 0,
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
  bills: number;
  averageBill: number;
  revenuePerLead: number;
}

/** The campaign-level split beneath each channel. */
export async function getCampaignBreakdown(range: DateRange = {}): Promise<CampaignRow[]> {
  const rows = await query(`
    WITH ${buildScoped(range)}
    SELECT cp.name,
           s.channel,
           COUNT(*)::int                            AS people,
           COUNT(*) FILTER (WHERE s.converted)::int AS buyers,
           COALESCE(SUM(s.total_sales) FILTER (WHERE s.converted), 0)::numeric AS revenue,
           COALESCE(SUM(s.bill_count), 0)::int      AS bills
    FROM   scoped s
    JOIN   campaigns cp ON cp.id = s.campaign_id
    GROUP  BY cp.name, s.channel
    ORDER  BY revenue DESC`);

  return rows.map((r) => {
    const people = Number(r.people ?? 0);
    const buyers = Number(r.buyers ?? 0);
    const revenue = Number(r.revenue ?? 0);
    const bills = Number(r.bills ?? 0);
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
      bills,
      averageBill: bills ? revenue / bills : 0,
      revenuePerLead: people ? revenue / people : 0,
    };
  });
}

export interface ChannelCombination {
  /** Channel codes, sorted — the exact set of lists this person is on. */
  channels: string[];
  people: number;
  buyers: number;
}

export interface ListOverlap {
  combinations: ChannelCombination[];
  onOneList: number;
  onTwoLists: number;
  onThreeOrMore: number;
  totalPeople: number;
  totalBuyers: number;
}

/**
 * Which lists each person is actually on, as exact combinations rather than
 * per-channel totals.
 *
 * This replaced a raw per-channel reach table. That table gave four numbers
 * summing to 6,167 against 5,866 distinct people and left the reader to work
 * out where the extra 301 went. Grouping by the *set* of lists a person appears
 * on answers it directly: the rows are disjoint, they sum to the distinct
 * total, and the overlap is named instead of implied.
 *
 * Sets come back sorted by channel code, so the label reads in a stable order
 * ("Instagram + WhatsApp", never "WhatsApp + Instagram").
 */
export async function getListOverlap(): Promise<ListOverlap> {
  const rows = await query(`
    WITH sets AS (
      SELECT customer_id,
             ARRAY_AGG(DISTINCT channel::text ORDER BY channel::text) AS channels
      FROM   lead_touches
      WHERE  channel IN (${IN_SCOPE})
      GROUP  BY customer_id
    )
    SELECT channels,
           COUNT(*)::int AS people,
           COUNT(*) FILTER (
             WHERE EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = sets.customer_id)
           )::int AS buyers
    FROM   sets
    GROUP  BY channels
    ORDER  BY people DESC, channels`);

  const combinations = rows.map((r) => ({
    channels: (r.channels as string[]) ?? [],
    people: Number(r.people ?? 0),
    buyers: Number(r.buyers ?? 0),
  }));

  // Derived here rather than in a second query so the summary line and the
  // table can never disagree — they are the same rows counted two ways.
  const sumWhere = (fn: (c: ChannelCombination) => boolean) =>
    combinations.filter(fn).reduce((n, c) => n + c.people, 0);

  return {
    combinations,
    onOneList: sumWhere((c) => c.channels.length === 1),
    onTwoLists: sumWhere((c) => c.channels.length === 2),
    onThreeOrMore: sumWhere((c) => c.channels.length >= 3),
    totalPeople: combinations.reduce((n, c) => n + c.people, 0),
    totalBuyers: combinations.reduce((n, c) => n + c.buyers, 0),
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
export async function getStoreBreakdown(range: DateRange = {}): Promise<StoreRow[]> {
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
    LEFT   JOIN sales s ON s.store_id = st.id${dateCondition('s', range)}
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

export interface StoreChannelRow {
  channel: string;
  buyers: number;
  revenue: number;
  /** Share of this store's own identified revenue, not of the business total. */
  share: number;
}

export interface StoreChannelMix {
  store: string;
  total: number;
  channels: StoreChannelRow[];
}

/**
 * Channel mix per branch — what the store panel and the channel panel never
 * cross on their own. Two branches can post similar totals while running on
 * entirely different kinds of customer, and neither panel alone shows it.
 *
 * Reads `customer_attribution.primary_channel` rather than the dashboard's own
 * `SCOPED` CTE, deliberately: a branch's revenue includes its existing
 * customers, who by definition (D-36) have no lead touch and would vanish from
 * a lead-scoped join the way they once vanished from the KPI tile (see the note
 * on `existing` in `getKpis`). `customer_attribution` already resolves
 * `existing` as its own segment, so it is the one place this figure is correct
 * without re-deriving the existing-customer logic a second time.
 *
 * Unlike `existing` in `getKpis`, this *is* safe to window: only `channel`
 * identity comes from the materialized view, and identity does not change
 * with a date range. Every summed figure is read straight off `sales`.
 */
export async function getStoreChannelMix(range: DateRange = {}): Promise<StoreChannelMix[]> {
  const rows = await query(`
    SELECT st.name                                        AS store,
           ca.primary_channel::text                       AS channel,
           COUNT(DISTINCT s.customer_id)::int             AS buyers,
           COALESCE(ROUND(SUM(s.bill_amount)), 0)::bigint AS revenue
    FROM   sales s
    JOIN   stores st ON st.id = s.store_id
    JOIN   customer_attribution ca ON ca.customer_id = s.customer_id
    WHERE  true${dateCondition('s', range)}
    GROUP  BY 1, 2 ORDER BY st.name, revenue DESC`);

  const byStore = new Map<string, StoreChannelMix>();
  for (const r of rows) {
    const store = String(r.store);
    if (!byStore.has(store)) byStore.set(store, { store, total: 0, channels: [] });
    const entry = byStore.get(store)!;
    const revenue = Number(r.revenue ?? 0);
    entry.total += revenue;
    entry.channels.push({ channel: String(r.channel), buyers: Number(r.buyers ?? 0), revenue, share: 0 });
  }

  for (const entry of byStore.values()) {
    for (const c of entry.channels) c.share = entry.total ? (100 * c.revenue) / entry.total : 0;
  }
  return [...byStore.values()].sort((a, b) => b.total - a.total);
}

export type { ValueTierCode };

/**
 * Every customer's value tier, keyed by `customer_id` — a CTE, not a table, so
 * it is exported as a raw fragment for other queries to join against rather
 * than computed twice.
 *
 * Buyers are ranked by lifetime spend and split into tenths (same method as
 * the Insights revenue-concentration chart, so the two never disagree):
 * decile 1 is `top10`, deciles 2–3 are `next20`, the rest are `rest70`.
 * Non-buyers get `none` outright rather than a decile among people who spent
 * nothing — ranking zeros against each other would manufacture a distinction
 * that isn't there.
 *
 * Ranks over `customer_attribution.total_sales`, which is business-wide
 * lifetime spend (D-36) — a person's value tier does not depend on which
 * channel query happens to be asking about them.
 */
export const VALUE_TIER = `
  value_tier AS (
    SELECT customer_id, tier FROM (
      SELECT customer_id,
             CASE WHEN decile = 1 THEN 'top10'
                  WHEN decile <= 3 THEN 'next20'
                  ELSE 'rest70' END AS tier
      FROM (
        SELECT customer_id,
               NTILE(10) OVER (ORDER BY total_sales DESC, customer_id) AS decile
        FROM   customer_attribution WHERE converted
      ) ranked
      UNION ALL
      SELECT customer_id, 'none' AS tier FROM customer_attribution WHERE NOT converted
    ) t
  )
`;

export interface ValueTierChannelRow {
  channel: string;
  people: number;
  revenue: number;
  /**
   * Share of this tier's own revenue — not of the business total. Falls back
   * to share of the tier's *people* when the tier has no revenue to split
   * (the `none` tier, by construction): a channel breakdown that reads
   * "0% · 0% · 0% · 0%" for every entry would look broken rather than simply
   * reporting the true fact that nobody in this tier has bought anything yet.
   */
  share: number;
}

export interface ValueTierRow {
  tier: ValueTierCode;
  label: string;
  people: number;
  revenue: number;
  /** Share of identified revenue business-wide — these five rows sum to 100%. */
  shareOfRevenue: number;
  channels: ValueTierChannelRow[];
}

export interface CustomerValueTiers {
  tiers: ValueTierRow[];
  totalPeople: number;
  totalRevenue: number;
}

/**
 * The concentration finding, made actionable: not just "43% of revenue sits
 * with 65 people" but which channels actually reached those 65. Read together
 * with `getChannelValue`, this is what turns "the top decile matters" into
 * "the top decile is reachable through these channels, in these proportions."
 */
export async function getCustomerValueTiers(): Promise<CustomerValueTiers> {
  const rows = await query(`
    WITH ${VALUE_TIER}
    SELECT vt.tier,
           ca.primary_channel::text                       AS channel,
           COUNT(*)::int                                   AS people,
           COALESCE(ROUND(SUM(ca.total_sales)), 0)::bigint AS revenue
    FROM   value_tier vt
    JOIN   customer_attribution ca ON ca.customer_id = vt.customer_id
    GROUP  BY 1, 2`);

  const totalRevenue = rows.reduce((n, r) => n + Number(r.revenue ?? 0), 0);
  const totalPeople = rows.reduce((n, r) => n + Number(r.people ?? 0), 0);

  const byTier = new Map<ValueTierCode, ValueTierRow>();
  for (const tier of VALUE_TIER_ORDER) {
    byTier.set(tier, { tier, label: VALUE_TIER_LABEL[tier], people: 0, revenue: 0, shareOfRevenue: 0, channels: [] });
  }

  for (const r of rows) {
    const tier = String(r.tier) as ValueTierCode;
    const entry = byTier.get(tier);
    if (!entry) continue; // schema guarantees one of the four codes; guard only
    const people = Number(r.people ?? 0);
    const revenue = Number(r.revenue ?? 0);
    entry.people += people;
    entry.revenue += revenue;
    entry.channels.push({ channel: String(r.channel), people, revenue, share: 0 });
  }

  for (const entry of byTier.values()) {
    entry.shareOfRevenue = totalRevenue ? (100 * entry.revenue) / totalRevenue : 0;
    const byRevenue = entry.revenue > 0;
    entry.channels.sort((a, b) => (byRevenue ? b.revenue - a.revenue : b.people - a.people));
    const denom = byRevenue ? entry.revenue : entry.people;
    for (const c of entry.channels) {
      const numerator = byRevenue ? c.revenue : c.people;
      c.share = denom ? (100 * numerator) / denom : 0;
    }
  }

  return {
    tiers: VALUE_TIER_ORDER.map((t) => byTier.get(t)!),
    totalPeople,
    totalRevenue,
  };
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
 *
 * `range` bounds the two sales-derived figures (phone-less, unmatched) — a
 * date filter should shrink "how much is unexplained" along with everything
 * else it shrinks. Rejects and estimated-touch counts are import- and
 * lead-time facts, not sale-time ones, so they stay whole-of-load regardless
 * of `range`.
 */
export async function getDataQuality(range: DateRange = {}): Promise<DataQuality> {
  const [row] = await query(`
    WITH scoped_customers AS (
      SELECT DISTINCT customer_id FROM lead_touches WHERE channel IN (${IN_SCOPE})
    )
    SELECT
      (SELECT COUNT(*)::int FROM import_rows_rejected r
        JOIN import_batches b ON b.id = r.batch_id
        WHERE NOT r.resolved AND b.source_type IN (${IN_SCOPE})) AS rejected,
      (SELECT COUNT(*)::int FROM sales WHERE customer_id IS NULL AND true${dateCondition('sales', range)}) AS phoneless_n,
      (SELECT COALESCE(SUM(bill_amount),0)::numeric FROM sales WHERE customer_id IS NULL AND true${dateCondition('sales', range)}) AS phoneless_rev,
      (SELECT COUNT(DISTINCT s.customer_id)::int FROM sales s
        WHERE s.customer_id IS NOT NULL${dateCondition('s', range)}
          AND NOT EXISTS (SELECT 1 FROM scoped_customers sc WHERE sc.customer_id = s.customer_id)) AS unmatched_n,
      (SELECT COALESCE(SUM(s.bill_amount),0)::numeric FROM sales s
        WHERE s.customer_id IS NOT NULL${dateCondition('s', range)}
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
