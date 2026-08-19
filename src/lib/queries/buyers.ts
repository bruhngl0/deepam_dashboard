/**
 * Buyer profile queries — the people who actually bought, not the people who
 * were marketed to.
 *
 * ── Why this is its own module ───────────────────────────────────────────────
 * `customers.ts` lists *leads* (D-86: only people with at least one lead
 * touch), which is the right scope for judging acquisition and the wrong one
 * for judging buyers: 1,853 of the 3,209 people who have placed a bill match
 * no lead record at all and are invisible there. This module inverts that —
 * the population is `sales.customer_id IS NOT NULL`, and a lead touch is one
 * more attribute a buyer may or may not have, not the price of admission.
 *
 * ── Bills are not visits (the correction this module exists to make) ─────────
 * Counting bills overstates repeat behaviour badly. Of the 871 consecutive
 * bill-pairs belonging to the same customer, 573 fall on the *same day* —
 * they are one shopping trip split across several vouchers (separate tenders,
 * separate salesmen, a return-and-rebuy), not a customer who came back. By
 * bills, 638 people look like repeat customers; by distinct visit dates, 246
 * do. Every frequency figure below is therefore computed on
 * `COUNT(DISTINCT (billed_at AT TIME ZONE 'Asia/Kolkata')::date)`, and `bills`
 * is reported alongside it rather than instead of it, so the gap between the
 * two is visible instead of being silently resolved in the flattering
 * direction.
 *
 * ── Recency is measured against the data, not the clock ──────────────────────
 * `daysSinceLast` counts back from `MAX(billed_at)` across all loaded sales,
 * not from `now()`. Sales arrive as periodic exports (D-04, appended not
 * replaced), so the gap between the last bill in the database and today is a
 * fact about when someone last ran an import — not about the customer. Using
 * `now()` would age every buyer in the book by that gap in lockstep and make
 * a freshly-loaded week look like a churn event. `dataThrough` is returned on
 * the profile so the page can state which date the recency is relative to.
 *
 * ── Value tier is recomputed here, not read from `customer_attribution` ──────
 * `dashboard.ts`'s `VALUE_TIER` ranks over the `customer_attribution`
 * materialized view. That view is refreshed by the import path and currently
 * knows 2,323 of the 4,080 attributed bills (₹4.81 Cr of ₹8.35 Cr) — ranking
 * buyers through it would place people by a little over half their spend.
 * The tiers below are NTILE(10) over live `sales`, so a buyer's tier here
 * matches the money in the table it was computed from. `'none'` from
 * `ValueTierCode` never occurs in this module: every row in the population is
 * by definition a buyer.
 *
 * ── What lifecycle can and cannot tell you ───────────────────────────────────
 * `customers.lifecycle` is useless for splitting buyers: all 3,209 come back
 * `existing`/`prior_purchase`, because the recompute treats *any* bill as
 * proof of prior purchase, which every buyer trivially has. The honest split
 * uses evidence that predates this sales window — a `loyalty_customers` row
 * with `total_bill_count > 0` (602 buyers, avg 3.2 prior bills and ₹70,456
 * lifetime, dormant ~5.8 years before returning) — and is exposed as the
 * `reactivated` / `net_new` segment rather than as a lifecycle chip.
 */

import { db } from '@/db';
import { sql, type SQL } from 'drizzle-orm';
import { scopeCondition, type DateRange } from './dashboard';
import type { ValueTierCode } from '@/lib/format';

type Row = Record<string, unknown>;

async function query(statement: SQL): Promise<Row[]> {
  const result = (await db.execute(statement)) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/**
 * The only gate a buyer id passes through. Ids are `bigserial`, so anything
 * that isn't a positive integer is a hand-edited URL, not a row — return
 * `null` and let the caller 404 rather than coercing it to `0` and querying.
 */
export function parseBuyerId(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,18}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** IST-local calendar date of a bill — the unit a "visit" is counted in. */
const VISIT_DATE = `(s.billed_at AT TIME ZONE 'Asia/Kolkata')::date`;

/**
 * Per-buyer aggregates over `sales`, narrowed by the master filter. Built
 * fresh per call the same way `customers.ts`'s `buildScopedCte` is, because
 * the scope fragments are interpolated strings (already gated by
 * `parseDateParam`/`parseStoreParam` in dashboard.ts) rather than bound
 * parameters.
 *
 * `visits` and `units` are the two figures a bill-level `COUNT(*)`/`SUM`
 * would get wrong: see the module header on same-day splits, and note that
 * `qty` is nullable on `sales` even though it is populated on every row
 * loaded so far.
 */
function buyerAggCte(range: DateRange): string {
  return `
  buyer_agg AS (
    SELECT s.customer_id                                          AS customer_id,
           COUNT(*)::int                                          AS bills,
           COUNT(DISTINCT ${VISIT_DATE})::int                     AS visits,
           COALESCE(SUM(s.bill_amount), 0)::numeric               AS total_spend,
           COALESCE(SUM(s.qty), 0)::int                           AS units,
           COALESCE(SUM(s.item_disc_amount), 0)::numeric          AS discount,
           MIN(s.billed_at)                                       AS first_purchase,
           MAX(s.billed_at)                                       AS last_purchase,
           COUNT(DISTINCT s.store_id)::int                        AS store_count
    FROM   sales s
    WHERE  s.customer_id IS NOT NULL${scopeCondition('s', range)}
    GROUP  BY s.customer_id
  ),
  tiered AS (
    SELECT customer_id,
           CASE WHEN decile = 1 THEN 'top10'
                WHEN decile <= 3 THEN 'next20'
                ELSE 'rest70' END AS value_tier,
           spend_rank
    FROM (
      SELECT customer_id,
             NTILE(10) OVER (ORDER BY total_spend DESC, customer_id)::int AS decile,
             RANK()    OVER (ORDER BY total_spend DESC)::int              AS spend_rank
      FROM   buyer_agg
    ) r
  )`;
}

// ── List ─────────────────────────────────────────────────────────────────────

export type BuyerSegment = 'repeat' | 'one_time' | 'reactivated' | 'net_new';

export interface BuyerFilters {
  q?: string;
  store?: string;
  tier?: ValueTierCode;
  segment?: BuyerSegment;
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
  sort?: 'spend' | 'recent' | 'visits' | 'name';
}

export interface BuyerListRow {
  id: number;
  fullName: string | null;
  phoneE164: string;
  bills: number;
  visits: number;
  totalSpend: number;
  units: number;
  avgBill: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
  valueTier: ValueTierCode;
  storeName: string | null;
  storeCount: number;
  /** Had bills on record before this sales window — the reactivation signal. */
  hasPriorHistory: boolean;
  priorBills: number;
  channels: string[];
}

export interface BuyerPage {
  rows: BuyerListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Population totals, unfiltered by q/tier/segment — the denominator a page reports against. */
  buyerCount: number;
}

const SORTS: Record<string, string> = {
  spend: 'b.total_spend DESC, b.customer_id',
  recent: 'b.last_purchase DESC, b.customer_id',
  visits: 'b.visits DESC, b.total_spend DESC, b.customer_id',
  name: 'c.full_name ASC NULLS LAST, b.customer_id',
};

/**
 * `home_store` is the store a buyer spent the most at, not the only one they
 * used — 40 buyers cross stores and collapsing them to a single label would
 * quietly lose that. `store_count` travels alongside so the table can mark it.
 */
function buyerSelectCte(range: DateRange): string {
  return `
  home_store AS (
    SELECT DISTINCT ON (s.customer_id) s.customer_id, st.name AS store_name
    FROM   sales s
    JOIN   stores st ON st.id = s.store_id
    WHERE  s.customer_id IS NOT NULL${scopeCondition('s', range)}
    GROUP  BY s.customer_id, st.name
    ORDER  BY s.customer_id, SUM(s.bill_amount) DESC
  ),
  prior AS (
    SELECT customer_id,
           COALESCE(total_bill_count, 0)::int AS prior_bills
    FROM   loyalty_customers
  ),
  touched AS (
    SELECT customer_id, ARRAY_AGG(DISTINCT channel::text ORDER BY channel::text) AS channels
    FROM   lead_touches GROUP BY customer_id
  )`;
}

export async function getBuyers(filters: BuyerFilters = {}): Promise<BuyerPage> {
  const range: DateRange = { from: filters.from, to: filters.to, store: filters.store };
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filters.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const orderBy = SORTS[filters.sort ?? 'spend'] ?? SORTS.spend;

  const conditions: SQL[] = [];
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    conditions.push(
      sql`(c.full_name ILIKE ${term} OR c.phone_national LIKE ${term} OR c.email ILIKE ${term})`,
    );
  }
  if (filters.tier && filters.tier !== 'none') conditions.push(sql`t.value_tier = ${filters.tier}`);
  if (filters.segment === 'repeat') conditions.push(sql`b.visits >= 2`);
  if (filters.segment === 'one_time') conditions.push(sql`b.visits = 1`);
  if (filters.segment === 'reactivated') conditions.push(sql`COALESCE(p.prior_bills, 0) > 0`);
  if (filters.segment === 'net_new') conditions.push(sql`COALESCE(p.prior_bills, 0) = 0`);

  const where = conditions.length
    ? sql.join([sql` AND `, sql.join(conditions, sql` AND `)])
    : sql``;

  const cte = sql.raw(`WITH ${buyerAggCte(range)},${buyerSelectCte(range)}`);

  const from = sql`
    FROM   buyer_agg b
    JOIN   customers c ON c.id = b.customer_id
    JOIN   tiered   t ON t.customer_id = b.customer_id
    LEFT   JOIN home_store h ON h.customer_id = b.customer_id
    LEFT   JOIN prior      p ON p.customer_id = b.customer_id
    LEFT   JOIN touched    x ON x.customer_id = b.customer_id
    WHERE  TRUE${where}`;

  const [countRow] = await query(sql`
    ${cte}
    SELECT COUNT(*)::int AS total,
           (SELECT COUNT(*)::int FROM buyer_agg) AS buyer_count
    ${from}`);

  const rows = await query(sql`
    ${cte}
    SELECT b.customer_id, c.full_name, c.phone_e164,
           b.bills, b.visits, b.total_spend, b.units, b.store_count,
           b.first_purchase, b.last_purchase,
           t.value_tier, h.store_name,
           COALESCE(p.prior_bills, 0) AS prior_bills,
           COALESCE(x.channels, ARRAY[]::text[]) AS channels
    ${from}
    ORDER  BY ${sql.raw(orderBy)}
    LIMIT  ${pageSize} OFFSET ${offset}`);

  const total = num(countRow?.total);

  return {
    rows: rows.map((r) => {
      const bills = num(r.bills);
      const totalSpend = num(r.total_spend);
      return {
        id: num(r.customer_id),
        fullName: str(r.full_name),
        phoneE164: String(r.phone_e164),
        bills,
        visits: num(r.visits),
        totalSpend,
        units: num(r.units),
        avgBill: bills ? totalSpend / bills : 0,
        firstPurchase: r.first_purchase ? new Date(r.first_purchase as string).toISOString() : null,
        lastPurchase: r.last_purchase ? new Date(r.last_purchase as string).toISOString() : null,
        valueTier: String(r.value_tier) as ValueTierCode,
        storeName: str(r.store_name),
        storeCount: num(r.store_count),
        hasPriorHistory: num(r.prior_bills) > 0,
        priorBills: num(r.prior_bills),
        channels: (r.channels as string[]) ?? [],
      };
    }),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    buyerCount: num(countRow?.buyer_count),
  };
}

// ── Profile ──────────────────────────────────────────────────────────────────

export interface StoreSplit {
  storeName: string;
  bills: number;
  spend: number;
}

export interface PaymentSplit {
  method: string;
  bills: number;
  amount: number;
}

export interface SalesmanSplit {
  code: string;
  bills: number;
  spend: number;
}

export interface RhythmSlice {
  label: string;
  bills: number;
  spend: number;
}

/** Pre-window purchase history from the loyalty master — the only evidence that predates the sales file. */
export interface PriorHistory {
  loyaltyType: string | null;
  registeredStore: string | null;
  bills: number;
  amount: number;
  firstBillDate: string | null;
  lastBillDate: string | null;
  /** Days between the last historical bill and the first bill in this window. */
  dormantDays: number | null;
}

export interface Acquisition {
  channels: string[];
  campaigns: string[];
  firstTouchAt: string | null;
  touchEstimated: boolean;
  finalRemark: string | null;
}

export interface BillLine {
  voucherNo: string;
  billedAt: string;
  visitDate: string;
  storeName: string;
  amount: number;
  qty: number;
  discount: number;
  salesmanCode: string | null;
  payments: Record<string, number>;
}

export interface Visit {
  date: string;
  bills: BillLine[];
  spend: number;
  qty: number;
}

export interface BuyerProfile {
  id: number;
  fullName: string | null;
  phoneE164: string;
  email: string | null;
  city: string | null;
  dateOfBirth: string | null;
  anniversary: string | null;

  bills: number;
  visits: number;
  totalSpend: number;
  units: number;
  avgBill: number;
  avgVisit: number;
  medianBill: number;
  largestBill: number;
  discount: number;
  /** Discount as a share of gross (bill + discount) — how much of this buyer's price is markdown. */
  discountRate: number;
  discountedBills: number;

  firstPurchase: string | null;
  lastPurchase: string | null;
  /** Counted back from `dataThrough`, never from `now()` — see module header. */
  daysSinceLast: number | null;
  /** Days between first and last purchase inside the loaded window. */
  spanDays: number | null;
  /** Median days between visits; `null` for a single-visit buyer. */
  medianVisitGap: number | null;

  valueTier: ValueTierCode;
  spendRank: number;
  buyerCount: number;
  /** Share of all buyers this person outspends, 0–100. */
  spendPercentile: number;
  peerAvgBill: number;
  peerAvgSpend: number;
  /** Latest `billed_at` in the whole sales table — the "as of" date for recency. */
  dataThrough: string | null;

  stores: StoreSplit[];
  payments: PaymentSplit[];
  salesmen: SalesmanSplit[];
  byDay: RhythmSlice[];
  byBand: RhythmSlice[];
  prior: PriorHistory | null;
  acquisition: Acquisition | null;
  visitLog: Visit[];
}

const DAY_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BAND_LABEL = ['Morning · before 12pm', 'Afternoon · 12–5pm', 'Evening · 5–9pm', 'Night · after 9pm'];

/** `EXTRACT(HOUR …)` band, matching `analysis.ts`'s `getSalesRhythm` exactly so the two never disagree. */
const BAND_EXPR = `(CASE
    WHEN EXTRACT(HOUR FROM s.billed_at AT TIME ZONE 'Asia/Kolkata') < 12 THEN 0
    WHEN EXTRACT(HOUR FROM s.billed_at AT TIME ZONE 'Asia/Kolkata') < 17 THEN 1
    WHEN EXTRACT(HOUR FROM s.billed_at AT TIME ZONE 'Asia/Kolkata') < 21 THEN 2
    ELSE 3 END)::int`;

/**
 * One buyer, every angle the bill-level data supports.
 *
 * Deliberately several round trips rather than one CTE stack: each block below
 * answers a different question at a different grain (per bill, per payment
 * method, per weekday), and fusing them would need either a lateral per block
 * or a fan-out that double-counts revenue the moment a bill has two tenders —
 * 476 of them do. They run concurrently, and every one of them is a single
 * indexed lookup on `sales_customer_idx`.
 *
 * `range` narrows the sales-derived figures the same way it narrows the rest
 * of `/crm`. `prior`, `acquisition` and the peer baselines deliberately ignore
 * it: pre-window history, lead touches and the business-wide average are not
 * things a date picker can meaningfully shrink.
 */
export async function getBuyerProfile(
  id: number,
  range: DateRange = {},
): Promise<BuyerProfile | null> {
  const scope = sql.raw(scopeCondition('s', range));
  const cte = sql.raw(`WITH ${buyerAggCte(range)}`);

  const [head] = await query(sql`
    ${cte}
    SELECT c.id, c.full_name, c.phone_e164, c.email, c.city, c.date_of_birth, c.anniversary,
           b.bills, b.visits, b.total_spend, b.units, b.discount,
           b.first_purchase, b.last_purchase,
           t.value_tier, t.spend_rank,
           (SELECT COUNT(*)::int FROM buyer_agg)                     AS buyer_count,
           (SELECT AVG(total_spend) FROM buyer_agg)                  AS peer_avg_spend,
           (SELECT SUM(total_spend) / NULLIF(SUM(bills), 0) FROM buyer_agg) AS peer_avg_bill,
           (SELECT MAX(billed_at) FROM sales)                        AS data_through
    FROM   buyer_agg b
    JOIN   customers c ON c.id = b.customer_id
    JOIN   tiered   t ON t.customer_id = b.customer_id
    WHERE  b.customer_id = ${id}`);

  // No aggregate row means no bills in scope — either an unknown id or a
  // customer who bought outside the selected window. Both are a 404 for this
  // page; the caller cannot tell them apart and does not need to.
  if (!head) return null;

  const [billStats, stores, payments, salesmen, dayRows, bandRows, priorRow, acqRow, billRows] =
    await Promise.all([
      query(sql`
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.bill_amount)::numeric AS median_bill,
               MAX(s.bill_amount)                                                  AS largest_bill,
               COUNT(*) FILTER (WHERE COALESCE(s.item_disc_amount, 0) > 0)::int    AS discounted_bills
        FROM   sales s WHERE s.customer_id = ${id}${scope}`),

      query(sql`
        SELECT st.name AS store_name, COUNT(*)::int AS bills, SUM(s.bill_amount) AS spend
        FROM   sales s JOIN stores st ON st.id = s.store_id
        WHERE  s.customer_id = ${id}${scope}
        GROUP  BY st.name ORDER BY spend DESC`),

      // `jsonb_each_text` fans a split-tender bill into one row per method, so
      // `SUM(amount)` stays the money actually taken by that method while
      // `COUNT(*)` counts bills that used it — the two never add to the same
      // total for a split-tender buyer, and shouldn't.
      query(sql`
        SELECT p.key AS method, COUNT(*)::int AS bills, SUM(p.value::numeric) AS amount
        FROM   sales s, LATERAL jsonb_each_text(s.payments) p
        WHERE  s.customer_id = ${id}${scope}
        GROUP  BY p.key ORDER BY amount DESC`),

      query(sql`
        SELECT s.salesman_code AS code, COUNT(*)::int AS bills, SUM(s.bill_amount) AS spend
        FROM   sales s
        WHERE  s.customer_id = ${id} AND s.salesman_code IS NOT NULL${scope}
        GROUP  BY s.salesman_code ORDER BY spend DESC`),

      query(sql`
        SELECT EXTRACT(ISODOW FROM s.billed_at AT TIME ZONE 'Asia/Kolkata')::int AS dow,
               COUNT(*)::int AS bills, SUM(s.bill_amount) AS spend
        FROM   sales s WHERE s.customer_id = ${id}${scope}
        GROUP  BY 1 ORDER BY 1`),

      query(sql`
        SELECT ${sql.raw(BAND_EXPR)} AS band, COUNT(*)::int AS bills, SUM(s.bill_amount) AS spend
        FROM   sales s WHERE s.customer_id = ${id}${scope}
        GROUP  BY 1 ORDER BY 1`),

      query(sql`
        SELECT l.loyalty_type, l.registered_store_name, l.total_bill_count, l.total_bill_amount,
               l.first_bill_date, l.last_bill_date
        FROM   loyalty_customers l WHERE l.customer_id = ${id}`),

      query(sql`
        SELECT ARRAY_AGG(DISTINCT lt.channel::text ORDER BY lt.channel::text) AS channels,
               ARRAY_AGG(DISTINCT ca.name)                                    AS campaigns,
               MIN(lt.touched_at)                                             AS first_touch_at,
               BOOL_AND(lt.touched_at_is_estimated)                           AS touch_estimated,
               MIN(lf.final_remark::text)                                     AS final_remark
        FROM   lead_touches lt
        JOIN   campaigns ca ON ca.id = lt.campaign_id
        LEFT   JOIN lead_followups lf ON lf.lead_touch_id = lt.id
        WHERE  lt.customer_id = ${id}`),

      query(sql`
        SELECT s.voucher_no, s.billed_at, ${sql.raw(VISIT_DATE)} AS visit_date,
               st.name AS store_name, s.bill_amount, COALESCE(s.qty, 0)::int AS qty,
               COALESCE(s.item_disc_amount, 0) AS discount, s.salesman_code, s.payments
        FROM   sales s JOIN stores st ON st.id = s.store_id
        WHERE  s.customer_id = ${id}${scope}
        ORDER  BY s.billed_at DESC`),
    ]);

  const bills = num(head.bills);
  const visitCount = num(head.visits);
  const totalSpend = num(head.total_spend);
  const discount = num(head.discount);
  const firstPurchase = head.first_purchase ? new Date(head.first_purchase as string) : null;
  const lastPurchase = head.last_purchase ? new Date(head.last_purchase as string) : null;
  const dataThrough = head.data_through ? new Date(head.data_through as string) : null;
  const buyerCount = num(head.buyer_count);
  const spendRank = num(head.spend_rank);

  const days = (a: Date | null, b: Date | null) =>
    a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : null;

  // Group bills into visits by their IST calendar date — the same key
  // `buyer_agg.visits` counts, so the log below and the tile above agree.
  const byVisit = new Map<string, Visit>();
  for (const r of billRows) {
    const date = String(r.visit_date);
    const line: BillLine = {
      voucherNo: String(r.voucher_no),
      billedAt: new Date(r.billed_at as string).toISOString(),
      visitDate: date,
      storeName: String(r.store_name),
      amount: num(r.bill_amount),
      qty: num(r.qty),
      discount: num(r.discount),
      salesmanCode: str(r.salesman_code),
      payments: (r.payments as Record<string, number>) ?? {},
    };
    const visit = byVisit.get(date) ?? { date, bills: [], spend: 0, qty: 0 };
    visit.bills.push(line);
    visit.spend += line.amount;
    visit.qty += line.qty;
    byVisit.set(date, visit);
  }
  const visitLog = [...byVisit.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  // Median gap between *visits*, not bills — a same-day second voucher would
  // otherwise report a zero-day repeat cycle, which is the exact artefact this
  // module exists to avoid. Ascending dates, so the diffs are positive.
  const visitDates = [...byVisit.keys()].sort();
  const gaps: number[] = [];
  for (let i = 1; i < visitDates.length; i++) {
    gaps.push(
      Math.round(
        (Date.parse(`${visitDates[i]}T00:00:00Z`) - Date.parse(`${visitDates[i - 1]}T00:00:00Z`)) /
          86_400_000,
      ),
    );
  }
  gaps.sort((a, b) => a - b);
  const medianVisitGap = gaps.length
    ? gaps.length % 2
      ? gaps[(gaps.length - 1) / 2]
      : Math.round((gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2)
    : null;

  const prior = priorRow[0];
  const priorLast = prior?.last_bill_date ? new Date(String(prior.last_bill_date)) : null;

  const acq = acqRow[0];
  const acqChannels = (acq?.channels as string[] | null) ?? [];

  return {
    id: num(head.id),
    fullName: str(head.full_name),
    phoneE164: String(head.phone_e164),
    email: str(head.email),
    city: str(head.city),
    dateOfBirth: str(head.date_of_birth),
    anniversary: str(head.anniversary),

    bills,
    visits: visitCount,
    totalSpend,
    units: num(head.units),
    avgBill: bills ? totalSpend / bills : 0,
    avgVisit: visitCount ? totalSpend / visitCount : 0,
    medianBill: num(billStats[0]?.median_bill),
    largestBill: num(billStats[0]?.largest_bill),
    discount,
    discountRate: totalSpend + discount > 0 ? (100 * discount) / (totalSpend + discount) : 0,
    discountedBills: num(billStats[0]?.discounted_bills),

    firstPurchase: firstPurchase?.toISOString() ?? null,
    lastPurchase: lastPurchase?.toISOString() ?? null,
    daysSinceLast: days(lastPurchase, dataThrough),
    spanDays: days(firstPurchase, lastPurchase),
    medianVisitGap,

    valueTier: String(head.value_tier) as ValueTierCode,
    spendRank,
    buyerCount,
    spendPercentile: buyerCount ? (100 * (buyerCount - spendRank)) / buyerCount : 0,
    peerAvgBill: num(head.peer_avg_bill),
    peerAvgSpend: num(head.peer_avg_spend),
    dataThrough: dataThrough?.toISOString() ?? null,

    stores: stores.map((r) => ({
      storeName: String(r.store_name),
      bills: num(r.bills),
      spend: num(r.spend),
    })),
    payments: payments.map((r) => ({
      method: String(r.method),
      bills: num(r.bills),
      amount: num(r.amount),
    })),
    salesmen: salesmen.map((r) => ({
      code: String(r.code),
      bills: num(r.bills),
      spend: num(r.spend),
    })),
    byDay: dayRows.map((r) => ({
      label: DAY_LABEL[num(r.dow)] ?? String(r.dow),
      bills: num(r.bills),
      spend: num(r.spend),
    })),
    byBand: bandRows.map((r) => ({
      label: BAND_LABEL[num(r.band)] ?? String(r.band),
      bills: num(r.bills),
      spend: num(r.spend),
    })),

    prior: prior
      ? {
          loyaltyType: str(prior.loyalty_type),
          registeredStore: str(prior.registered_store_name),
          bills: num(prior.total_bill_count),
          amount: num(prior.total_bill_amount),
          firstBillDate: str(prior.first_bill_date),
          lastBillDate: str(prior.last_bill_date),
          dormantDays: days(priorLast, firstPurchase),
        }
      : null,

    acquisition: acqChannels.length
      ? {
          channels: acqChannels,
          campaigns: ((acq?.campaigns as string[] | null) ?? []).filter(Boolean),
          firstTouchAt: acq?.first_touch_at
            ? new Date(acq.first_touch_at as string).toISOString()
            : null,
          touchEstimated: Boolean(acq?.touch_estimated),
          finalRemark: str(acq?.final_remark),
        }
      : null,

    visitLog,
  };
}
