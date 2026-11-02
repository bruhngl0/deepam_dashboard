/**
 * Queries behind /reports. Each reads the KPI views of the analytics database
 * (migration/analytics/030_model.sql), where every figure is defined once; these only pick a
 * period and sum. All return [] / null when analytics is not configured.
 */

import { aq } from './db';
import { isDay, shiftDay, todayIst } from '@/lib/queries/daily';

/** `store` is a Store ID (STR-001…), or null for every store. */
export type Period = { from: string; to: string; store: string | null };
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** ?from=&to= (IST days) and ?store= (a Store ID), defaulting to the last `days` days through today and every store. */
export function periodFrom(sp: Record<string, string | string[] | undefined>, days = 30): Period {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const today = todayIst();
  const to = isDay(one(sp.to)) && one(sp.to)! <= today ? one(sp.to)! : today;
  const from = isDay(one(sp.from)) && one(sp.from)! <= to ? one(sp.from)! : shiftDay(to, -(days - 1));
  const store = one(sp.store);
  return { from, to, store: store && /^STR-\d{3}$/.test(store) ? store : null };
}

export type ReportStore = { code: string; name: string };
/** The stores the store filter offers. */
export async function reportStores(): Promise<ReportStore[]> {
  const rows = await aq<Record<string, unknown>>(`SELECT store_code, name FROM analytics.dim_store ORDER BY store_code`);
  return (rows ?? []).map((r) => ({ code: String(r.store_code), name: String(r.name) }));
}

// Funnel ----------------------------------------------------------------------------------------------
export const FUNNEL_GROUPS = { store: 'Store', channel: 'Source', campaign: 'Campaign' } as const;
export type FunnelGroup = keyof typeof FUNNEL_GROUPS;
export type FunnelRow = { label: string; leads: number; called: number; walkedIn: number; bought: number; boughtAgain: number; sales: number };

export async function funnel(period: Period, by: FunnelGroup): Promise<FunnelRow[]> {
  const column = { store: "coalesce(s.name || ' (' || f.store_code || ')', 'No store recorded')", channel: "coalesce(f.channel, 'Unknown')", campaign: "coalesce(f.campaign, 'No campaign')" }[by];
  const rows = await aq<Record<string, unknown>>(`
    SELECT ${column} AS label, count(*) AS leads, count(*) FILTER (WHERE f.called) AS called, count(*) FILTER (WHERE f.walked_in) AS walked_in,
           count(*) FILTER (WHERE f.bills_after > 0) AS bought, count(*) FILTER (WHERE f.bills_after > 1) AS bought_again, sum(f.sales_after) AS sales
    FROM analytics.kpi_funnel_lead f LEFT JOIN analytics.dim_store s ON s.store_code = f.store_code
    WHERE f.lead_day BETWEEN $1 AND $2 AND ($3::text IS NULL OR f.store_code = $3) GROUP BY 1 ORDER BY count(*) DESC, 1`, [period.from, period.to, period.store]);
  return (rows ?? []).map((r) => ({ label: String(r.label), leads: n(r.leads), called: n(r.called), walkedIn: n(r.walked_in), bought: n(r.bought), boughtAgain: n(r.bought_again), sales: n(r.sales) }));
}

// Salespeople ----------------------------------------------------------------------------------------
export type SalespersonRow = { empCode: string; name: string; storeCode: string | null; walkIns: number; converted: number; bills: number; sales: number; calls: number; connected: number; interested: number };

export async function salespeople(period: Period): Promise<SalespersonRow[]> {
  const rows = await aq<Record<string, unknown>>(`
    SELECT emp_code, name, store_code, sum(walk_ins) AS walk_ins, sum(converted) AS converted, sum(bills) AS bills, sum(total_sales) AS sales,
           sum(calls) AS calls, sum(connected) AS connected, sum(interested) AS interested
    FROM analytics.kpi_salesperson_day WHERE day BETWEEN $1 AND $2 AND ($3::text IS NULL OR store_code = $3)
    GROUP BY 1, 2, 3 ORDER BY sum(total_sales) DESC, sum(walk_ins) DESC, name`, [period.from, period.to, period.store]);
  return (rows ?? []).map((r) => ({
    empCode: String(r.emp_code), name: String(r.name), storeCode: (r.store_code as string | null) ?? null,
    walkIns: n(r.walk_ins), converted: n(r.converted), bills: n(r.bills), sales: n(r.sales), calls: n(r.calls), connected: n(r.connected), interested: n(r.interested),
  }));
}

/** What is not credited to anyone in the period: bills and calls whose salesperson name is not matched yet. */
export async function unattributed(period: Period): Promise<{ bills: number; sales: number; calls: number; unmatchedNames: number }> {
  const rows = await aq<Record<string, unknown>>(`
    SELECT (SELECT count(*) FROM analytics.fact_bill WHERE emp_code IS NULL AND day BETWEEN $1 AND $2 AND ($3::text IS NULL OR store_code = $3)) AS bills,
           (SELECT coalesce(sum(amount), 0) FROM analytics.fact_bill WHERE emp_code IS NULL AND day BETWEEN $1 AND $2 AND ($3::text IS NULL OR store_code = $3)) AS sales,
           (SELECT count(*) FROM analytics.fact_call WHERE emp_code IS NULL AND day BETWEEN $1 AND $2) AS calls,
           (SELECT count(*) FROM analytics.salesperson_alias WHERE emp_code IS NULL) AS unmatched`, [period.from, period.to, period.store]);
  const r = rows?.[0] ?? {};
  return { bills: n(r.bills), sales: n(r.sales), calls: n(r.calls), unmatchedNames: n(r.unmatched) };
}

// Payback --------------------------------------------------------------------------------------------
export type DriverRow = { driverCode: string; name: string; visits: number; people: number; billedVisits: number; sales: number; commission: number; owed: number };

/** Same figures as analytics.kpi_driver_day, summed from the visits so they can be narrowed to the visit's store. */
export async function driverPayback(period: Period): Promise<DriverRow[]> {
  const rows = await aq<Record<string, unknown>>(`
    SELECT d.driver_code, d.name, count(v.visit_id) AS visits, coalesce(sum(v.people), 0) AS people,
           count(*) FILTER (WHERE coalesce(v.bill_amount, b.amount) IS NOT NULL) AS billed_visits,
           coalesce(sum(coalesce(v.bill_amount, b.amount)), 0) AS sales, coalesce(sum(v.commission), 0) AS commission,
           coalesce(sum(v.commission) FILTER (WHERE v.commission > 0 AND NOT v.paid), 0) AS owed
    FROM analytics.fact_driver_visit v JOIN analytics.dim_driver d ON d.driver_id = v.driver_id
    LEFT JOIN analytics.fact_walkin w ON w.walkin_id = v.walkin_id LEFT JOIN analytics.fact_bill b ON b.bill_id = w.bill_id
    WHERE v.day BETWEEN $1 AND $2 AND ($3::text IS NULL OR v.store_code = $3)
    GROUP BY 1, 2 ORDER BY 6 DESC, 3 DESC, d.name`, [period.from, period.to, period.store]);
  return (rows ?? []).map((r) => ({ driverCode: String(r.driver_code), name: String(r.name), visits: n(r.visits), people: n(r.people), billedVisits: n(r.billed_visits), sales: n(r.sales), commission: n(r.commission), owed: n(r.owed) }));
}

export type CampaignRow = { name: string; channel: string | null; spend: number | null; leads: number; called: number; walkedIn: number; converted: number; sales: number; costPerLead: number | null; salesPerRupee: number | null };

/**
 * Leads that arrived in the period (at the store, when one is picked) and what they did afterwards, per campaign.
 * Spend comes as campaign totals from the Campaign Summary tabs, so spend, cost per lead and sales per rupee stay
 * all-time figures: they cannot be split by date or store.
 */
export async function campaignPayback(period: Period): Promise<CampaignRow[]> {
  const rows = await aq<Record<string, unknown>>(`
    WITH f AS (
      SELECT campaign, count(*) AS leads, count(*) FILTER (WHERE called) AS called, count(*) FILTER (WHERE walked_in) AS walked_in,
             count(*) FILTER (WHERE bills_after > 0) AS converted, coalesce(sum(sales_after), 0) AS total_sales
      FROM analytics.kpi_funnel_lead WHERE lead_day BETWEEN $1 AND $2 AND ($3::text IS NULL OR store_code = $3) GROUP BY campaign)
    SELECT k.name, k.channel, k.spend, coalesce(f.leads, 0) AS leads, coalesce(f.called, 0) AS called, coalesce(f.walked_in, 0) AS walked_in,
           coalesce(f.converted, 0) AS converted, coalesce(f.total_sales, 0) AS total_sales, k.cost_per_lead, k.sales_per_rupee_spent
    FROM analytics.kpi_campaign k LEFT JOIN f ON f.campaign = k.name
    WHERE coalesce(f.leads, 0) > 0 ORDER BY k.spend DESC NULLS LAST, 4 DESC, k.name`, [period.from, period.to, period.store]);
  return (rows ?? []).map((r) => ({
    name: String(r.name), channel: (r.channel as string | null) ?? null, spend: r.spend === null ? null : n(r.spend), leads: n(r.leads), called: n(r.called),
    walkedIn: n(r.walked_in), converted: n(r.converted), sales: n(r.total_sales),
    costPerLead: r.cost_per_lead === null ? null : n(r.cost_per_lead), salesPerRupee: r.sales_per_rupee_spent === null ? null : n(r.sales_per_rupee_spent),
  }));
}

// Cohorts --------------------------------------------------------------------------------------------
export type CohortRow = { month: string; customers: number; back1: number; back3: number; back6: number; medianDays: number | null };

/**
 * Same figures as analytics.kpi_cohort, worked out from the bills so they can be narrowed: customers whose first bill
 * falls in the period's months, and (when a store is picked) whose first bill was at that store.
 */
export async function cohorts(period: Period): Promise<CohortRow[]> {
  const rows = await aq<Record<string, unknown>>(`
    WITH first AS (
      SELECT DISTINCT ON (person_id) person_id, billed_at AS first_at, store_code
      FROM analytics.fact_bill WHERE person_id IS NOT NULL ORDER BY person_id, billed_at),
    picked AS (
      SELECT * FROM first
      WHERE (first_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN date_trunc('month', $1::date)::date AND $2::date
        AND ($3::text IS NULL OR store_code = $3)),
    nxt AS (
      SELECT f.person_id, f.first_at, (SELECT min(b.billed_at) FROM analytics.fact_bill b WHERE b.person_id = f.person_id
        AND (b.billed_at AT TIME ZONE 'Asia/Kolkata')::date > (f.first_at AT TIME ZONE 'Asia/Kolkata')::date) AS next_at
      FROM picked f)
    SELECT date_trunc('month', first_at AT TIME ZONE 'Asia/Kolkata')::date::text AS month, count(*) AS customers,
      count(*) FILTER (WHERE next_at < first_at + interval '1 month') AS back_within_1m,
      count(*) FILTER (WHERE next_at < first_at + interval '3 months') AS back_within_3m,
      count(*) FILTER (WHERE next_at < first_at + interval '6 months') AS back_within_6m,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM next_at - first_at) / 86400) FILTER (WHERE next_at IS NOT NULL))::int AS median_days_to_return
    FROM nxt GROUP BY 1 ORDER BY 1 DESC`, [period.from, period.to, period.store]);
  return (rows ?? []).map((r) => ({ month: String(r.month), customers: n(r.customers), back1: n(r.back_within_1m), back3: n(r.back_within_3m), back6: n(r.back_within_6m), medianDays: r.median_days_to_return === null ? null : n(r.median_days_to_return) }));
}

// Stock ----------------------------------------------------------------------------------------------
export type StockStoreRow = { storeCode: string; name: string; qty: number; cost: number; agedQty: number; agedCost: number };
export type StockTrendRow = { day: string; storeCode: string; cost: number; agedCost: number };
export type SlowMover = { storeCode: string; vendor: string; item: string; qty: number; cost: number; lastSold: string | null };
/** Sell-through = units sold in the 30 days to the latest sale ÷ (those units + units in stock now). Company-wide: sales are not recorded per store. */
export type SellThrough = { sold: number; inStock: number; rate: number | null; salesFrom: string | null; salesThrough: string | null };

// The stock "as of" day is the last snapshot on or before the period's end; sales are company-wide (not recorded per store).
const AS_OF = `(SELECT max(snap_day) FROM analytics.fact_stock_day WHERE snap_day <= $1::date)`;

/** Stock per store on the last snapshot on or before the period's end (just the picked store, when one is). */
export async function stockByStore(period: Period): Promise<{ asOf: string | null; stores: StockStoreRow[]; sellThrough: SellThrough }> {
  const [rows, st] = await Promise.all([
    aq<Record<string, unknown>>(`
      SELECT k.store_code, coalesce(s.name, k.store_code) AS name, max(k.stock_as_of)::text AS as_of, sum(k.qty) AS qty, coalesce(sum(k.cost), 0) AS cost,
             coalesce(sum(k.aged_qty), 0) AS aged_qty, coalesce(sum(k.aged_cost), 0) AS aged_cost
      FROM analytics.fact_stock_day k LEFT JOIN analytics.dim_store s ON s.store_code = k.store_code
      WHERE k.snap_day = ${AS_OF} AND ($2::text IS NULL OR k.store_code = $2)
      GROUP BY 1, 2 ORDER BY 1`, [period.to, period.store]),
    aq<Record<string, unknown>>(`
      WITH through AS (SELECT max(day) AS day FROM analytics.fact_item_sales_day WHERE day <= $1::date)
      SELECT (SELECT coalesce(sum(qty), 0) FROM analytics.fact_item_sales_day, through WHERE fact_item_sales_day.day > through.day - 30 AND fact_item_sales_day.day <= through.day) AS sold,
             (SELECT coalesce(sum(qty), 0) FROM analytics.fact_stock_day WHERE snap_day = ${AS_OF} AND qty > 0) AS in_stock,
             (SELECT day::text FROM through) AS through, (SELECT min(day)::text FROM analytics.fact_item_sales_day) AS sales_from`, [period.to]),
  ]);
  const sold = n(st?.[0]?.sold), inStock = n(st?.[0]?.in_stock);
  return {
    asOf: rows?.[0] ? String(rows[0].as_of) : null,
    stores: (rows ?? []).map((r) => ({ storeCode: String(r.store_code), name: String(r.name), qty: n(r.qty), cost: n(r.cost), agedQty: n(r.aged_qty), agedCost: n(r.aged_cost) })),
    sellThrough: { sold, inStock, rate: sold + inStock > 0 ? sold / (sold + inStock) : null, salesFrom: (st?.[0]?.sales_from as string | null) ?? null, salesThrough: (st?.[0]?.through as string | null) ?? null },
  };
}

/** Stock value per store for each snapshot in the period. */
export async function stockTrend(period: Period): Promise<StockTrendRow[]> {
  const rows = await aq<Record<string, unknown>>(`
    SELECT snap_day::text AS day, store_code, stock_cost, aged_cost FROM analytics.kpi_stock_store
    WHERE snap_day BETWEEN $1 AND $2 AND ($3::text IS NULL OR store_code = $3) ORDER BY snap_day, store_code`, [period.from, period.to, period.store]);
  return (rows ?? []).map((r) => ({ day: String(r.day), storeCode: String(r.store_code), cost: n(r.stock_cost), agedCost: n(r.aged_cost) }));
}

/** In stock on the as-of snapshot but not sold anywhere in the 90 days before it, costliest first. */
export async function slowMovers(period: Period, limit = 50): Promise<SlowMover[]> {
  const rows = await aq<Record<string, unknown>>(`
    WITH latest AS (SELECT ${AS_OF} AS day),
    last_sold AS (SELECT i.vendor, i.item, max(i.day) AS day FROM analytics.fact_item_sales_day i, latest WHERE i.qty > 0 AND i.day <= latest.day GROUP BY 1, 2)
    SELECT k.store_code, k.vendor, k.item, k.qty, k.cost, ls.day::text AS last_sold
    FROM analytics.fact_stock_day k JOIN latest ON k.snap_day = latest.day
    LEFT JOIN last_sold ls ON ls.vendor = k.vendor AND ls.item = k.item
    WHERE k.qty > 0 AND (ls.day IS NULL OR ls.day <= latest.day - 90) AND ($2::text IS NULL OR k.store_code = $2)
    ORDER BY k.cost DESC NULLS LAST LIMIT $3`, [period.to, period.store, limit]);
  return (rows ?? []).map((r) => ({ storeCode: String(r.store_code), vendor: String(r.vendor), item: String(r.item), qty: n(r.qty), cost: n(r.cost), lastSold: (r.last_sold as string | null) ?? null }));
}
