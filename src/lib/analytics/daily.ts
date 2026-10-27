/**
 * The daily dashboard's figures from the analytics database: the same shapes the page has always used
 * (CRM's own tables + RC's and Vendor Intelligence's live answers), now from one copy where each KPI is
 * defined once (migration/analytics/030_model.sql). Returns null when analytics is not configured.
 */

import { aq } from './db';
import { storeName } from '@/lib/marketing/local';
import { shiftDay, type DailyCrm, type DailyStockValue } from '@/lib/queries/daily';
import type { RcDaily, StockAlerts } from '@/lib/integration/apps';

const RULES = { agedDays: 90, fastSellerDays: 30, fastSellerMinSold: 3, lowStockMax: 1 };
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function dailyFromAnalytics(date: string): Promise<{ crm: DailyCrm; rc: RcDaily; stock: StockAlerts | null } | null> {
  const stores = await aq<{ store_code: string; name: string }>('SELECT store_code, name FROM analytics.dim_store ORDER BY store_code');
  if (!stores) return null;

  const monthStart = `${date.slice(0, 8)}01`;
  const [day, through, calls, followups, unassigned, owed, snap, totals, lines, stockRows] = await Promise.all([
    aq<Record<string, unknown>>('SELECT * FROM analytics.kpi_store_day WHERE day = $1', [date]),
    aq<{ through: Date | null }>('SELECT max(billed_at) AS through FROM analytics.fact_bill'),
    aq<{ caller: string; calls: string; connected: string; interested: string }>(`
      SELECT caller_raw AS caller, count(*) AS calls, count(*) FILTER (WHERE connected) AS connected, count(*) FILTER (WHERE interested) AS interested
      FROM analytics.fact_call WHERE day = $1 GROUP BY caller_raw ORDER BY count(*) DESC, caller_raw`, [date]),
    aq<{ store: string; due_today: string; overdue: string }>(`
      SELECT coalesce(preferred_store, '') AS store,
             count(*) FILTER (WHERE (due_at AT TIME ZONE 'Asia/Kolkata')::date = $1) AS due_today,
             count(*) FILTER (WHERE (due_at AT TIME ZONE 'Asia/Kolkata')::date < $1) AS overdue
      FROM analytics.fact_followup WHERE done_at IS NULL AND (due_at AT TIME ZONE 'Asia/Kolkata')::date <= $1
      GROUP BY 1 ORDER BY 1`, [date]),
    aq<{ visits: string; people: string; commission: string }>(
      'SELECT count(*) AS visits, coalesce(sum(people), 0) AS people, coalesce(sum(commission), 0) AS commission FROM analytics.fact_driver_visit WHERE day = $1 AND store_code IS NULL', [date]),
    aq<{ store_code: string | null; visits: string; commission: string }>(`
      SELECT store_code, count(*) AS visits, sum(commission) AS commission FROM analytics.fact_driver_visit
      WHERE day <= $1 AND commission > 0 AND NOT paid GROUP BY store_code`, [date]),
    aq<{ snap_day: string; stock_as_of: string | null }>(`
      SELECT snap_day::text, max(stock_as_of)::text AS stock_as_of FROM analytics.fact_stock_day
      WHERE snap_day = (SELECT max(snap_day) FROM analytics.fact_stock_day WHERE snap_day <= $1) GROUP BY snap_day`, [date]),
    aq<{ store_code: string; prev_sales: string; mtd_sales: string }>(`
      SELECT store_code, coalesce(sum(total_sales) FILTER (WHERE day = $2), 0) AS prev_sales,
             coalesce(sum(total_sales) FILTER (WHERE day >= $3), 0) AS mtd_sales
      FROM analytics.kpi_store_day WHERE day BETWEEN LEAST($2::date, $3::date) AND $1 GROUP BY 1`, [date, shiftDay(date, -1), monthStart]),
    aq<{ store_code: string; units: string; cost: string }>(`
      SELECT b.store_code, coalesce(sum(l.qty), 0) AS units, coalesce(sum(l.cost), 0) AS cost
      FROM analytics.fact_bill b JOIN analytics.fact_bill_line l USING (bill_id) WHERE b.day = $1 GROUP BY 1`, [date]),
    stockValueRows(date),
  ]);

  const byStore = new Map((day ?? []).map((r) => [String(r.store_code), r]));
  const callRows = (calls ?? []).map((r) => ({ name: r.caller, calls: n(r.calls), connected: n(r.connected), interested: n(r.interested) }));
  const followupRows = (followups ?? []).map((r) => ({ store: storeName(r.store) || 'No store recorded', dueToday: n(r.due_today), overdue: n(r.overdue) }));

  const crm: DailyCrm = {
    date,
    stores: stores.map((s) => {
      const r = byStore.get(s.store_code);
      const t = (totals ?? []).find((x) => x.store_code === s.store_code);
      const l = (lines ?? []).find((x) => x.store_code === s.store_code);
      return {
        storeCode: s.store_code, name: s.name, walkIns: n(r?.walk_ins), people: n(r?.people), converted: n(r?.converted), bills: n(r?.bills), sales: n(r?.total_sales),
        units: n(l?.units), soldCost: n(l?.cost), prevSales: n(t?.prev_sales), mtdSales: n(t?.mtd_sales),
      };
    }),
    salesThrough: through?.[0]?.through ? new Date(through[0].through).toISOString() : null,
    calls: {
      calls: callRows.reduce((t, r) => t + r.calls, 0),
      connected: callRows.reduce((t, r) => t + r.connected, 0),
      interested: callRows.reduce((t, r) => t + r.interested, 0),
      bySalesperson: callRows,
    },
    followups: {
      dueToday: followupRows.reduce((t, r) => t + r.dueToday, 0),
      overdue: followupRows.reduce((t, r) => t + r.overdue, 0),
      byStore: followupRows,
    },
    stockValue: stockValue(stockRows),
  };

  const rcDay: RcDaily['day'] = stores.flatMap((s) => {
    const r = byStore.get(s.store_code);
    return r && n(r.driver_visits) ? [{ storeCode: s.store_code, visits: n(r.driver_visits), people: n(r.driver_people), convertedVisits: 0, billAmount: null, commission: n(r.commission) }] : [];
  });
  const none = unassigned?.[0];
  if (none && n(none.visits)) rcDay.push({ storeCode: null, visits: n(none.visits), people: n(none.people), convertedVisits: 0, billAmount: null, commission: n(none.commission) });
  const rc: RcDaily = { date, day: rcDay, owed: (owed ?? []).map((r) => ({ storeCode: r.store_code, visits: n(r.visits), commission: n(r.commission) })) };

  const snapDay = snap?.[0]?.snap_day ?? null;
  let stock: StockAlerts | null = null;
  if (snapDay) {
    const asOf = snap?.[0]?.stock_as_of ?? snapDay;
    const [aged, agedItems, salesThrough, low] = await Promise.all([
      aq<{ store_code: string; units: string; cost: string }>('SELECT store_code, sum(aged_qty) AS units, sum(aged_cost) AS cost FROM analytics.fact_stock_day WHERE snap_day = $1 AND aged_qty > 0 GROUP BY 1', [snapDay]),
      aq<{ store_code: string; vendor: string; item: string; units: string; cost: string; oldest: string | null }>(`
        SELECT store_code, vendor, item, aged_qty AS units, aged_cost AS cost, oldest_aged_inward::text AS oldest FROM (
          SELECT *, row_number() OVER (PARTITION BY store_code ORDER BY aged_cost DESC) AS rank FROM analytics.fact_stock_day WHERE snap_day = $1 AND aged_qty > 0) r
        WHERE rank <= 5`, [snapDay]),
      aq<{ through: string | null }>('SELECT max(day)::text AS through FROM analytics.fact_item_sales_day WHERE day <= $1', [date]),
      aq<{ store_code: string; vendor: string; item: string; left_qty: string; sold: string }>(`
        WITH sold AS (SELECT vendor, item, sum(qty) AS sold FROM analytics.fact_item_sales_day
                      WHERE day > (SELECT max(day) FROM analytics.fact_item_sales_day WHERE day <= $2) - $3::int AND day <= $2
                      GROUP BY 1, 2 HAVING sum(qty) >= $4)
        SELECT store_code, vendor, item, left_qty, sold FROM (
          SELECT s.store_code, s.vendor, s.item, s.qty AS left_qty, so.sold, row_number() OVER (PARTITION BY s.store_code ORDER BY so.sold DESC, s.qty) AS rank
          FROM analytics.fact_stock_day s JOIN sold so USING (vendor, item) WHERE s.snap_day = $1 AND s.qty <= $5) r
        WHERE rank <= 5`, [snapDay, date, RULES.fastSellerDays, RULES.fastSellerMinSold, RULES.lowStockMax]),
    ]);
    const map = new Map<string, StockAlerts['stores'][number]>();
    const get = (code: string) => {
      if (!map.has(code)) map.set(code, { storeCode: code, aged: { units: 0, cost: 0, items: [] }, lowFastSellers: [] });
      return map.get(code)!;
    };
    for (const r of aged ?? []) Object.assign(get(r.store_code).aged, { units: n(r.units), cost: Math.round(n(r.cost)) });
    for (const r of agedItems ?? []) get(r.store_code).aged.items.push({ vendor: r.vendor, item: r.item, units: n(r.units), cost: Math.round(n(r.cost)), oldestInward: r.oldest ?? asOf });
    for (const r of low ?? []) get(r.store_code).lowFastSellers.push({ vendor: r.vendor, item: r.item, left: n(r.left_qty), soldLast30Days: n(r.sold) });
    stock = { asOf, salesThrough: salesThrough?.[0]?.through ?? asOf, rules: RULES, stores: [...map.values()].sort((a, b) => a.storeCode.localeCompare(b.storeCode)) };
  }
  return { crm, rc, stock };
}

type StockValueRow = { as_of: string; store_code: string; report_cost: string; sold_after: string; sold_before: string; sold_today: string };

/**
 * Per store: the latest stock report's value at cost (the report dated on or before this day, else the
 * latest one), and the cost of goods sold after the report up to this day, between this day and the
 * report, and on this day. Only stores the report covers.
 */
function stockValueRows(date: string) {
  return aq<StockValueRow>(`
    WITH snap AS (
      SELECT snap_day, max(stock_as_of) AS as_of FROM analytics.fact_stock_day GROUP BY snap_day
      ORDER BY (max(stock_as_of) <= $1::date) DESC, snap_day DESC LIMIT 1
    ), report AS (
      SELECT store_code, sum(cost) AS cost FROM analytics.fact_stock_day WHERE snap_day = (SELECT snap_day FROM snap) GROUP BY 1
    ), sold AS (
      SELECT b.store_code,
             coalesce(sum(l.cost) FILTER (WHERE b.day > s.as_of AND b.day <= $1::date), 0) AS after,
             coalesce(sum(l.cost) FILTER (WHERE b.day > $1::date AND b.day <= s.as_of), 0) AS before,
             coalesce(sum(l.cost) FILTER (WHERE b.day = $1::date), 0) AS today
      FROM analytics.fact_bill b JOIN analytics.fact_bill_line l USING (bill_id) CROSS JOIN snap s
      WHERE b.day > LEAST(s.as_of, $1::date) - 1 GROUP BY 1
    )
    SELECT (SELECT as_of FROM snap)::text AS as_of, r.store_code, r.cost AS report_cost,
           coalesce(so.after, 0) AS sold_after, coalesce(so.before, 0) AS sold_before, coalesce(so.today, 0) AS sold_today
    FROM report r LEFT JOIN sold so USING (store_code)`, [date]);
}

/** Closing = report − sold after it up to this day + sold between this day and the report; opening = closing + sold this day. */
export function stockValue(rows: StockValueRow[] | null): DailyStockValue | null {
  if (!rows?.length) return null;
  return {
    asOf: rows[0].as_of,
    stores: rows.map((r) => {
      const closing = n(r.report_cost) - n(r.sold_after) + n(r.sold_before);
      return { storeCode: r.store_code, opening: closing + n(r.sold_today), sold: n(r.sold_today), closing };
    }),
  };
}
