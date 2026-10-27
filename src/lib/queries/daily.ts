/**
 * One day, every store: the figures CRM holds itself for the daily dashboard (/daily).
 * Driver visits come from RC and stock alerts from Vendor Intelligence (lib/integration/apps.ts).
 *
 * Days are IST calendar days. `store_visits.visited_at` and `sales.billed_at` are instants and
 * are converted; `marketing_calls.called_at` and the call-list follow-up columns are already
 * IST wall-clock times without a zone.
 */

import { sql } from 'drizzle-orm';
import { num, query, str } from './buyers';
import { storeName } from '@/lib/marketing/local';

export type DailyStore = {
  storeCode: string;
  name: string;
  walkIns: number;
  people: number;
  converted: number;
  bills: number;
  sales: number;
  /** Units on this day's bills, and what they cost (the bills' purchase value). */
  units: number;
  soldCost: number;
  /** Sales the day before, and from the 1st of the month to this day. */
  prevSales: number;
  mtdSales: number;
};

/**
 * Stock at cost for the day, per store, rolled from the latest stock report: closing = the report's
 * value, less the cost of what sold after it up to this day (or plus what sold between this day and
 * the report, for a day before it). Stock received is not connected yet, so it is not added.
 */
export type DailyStockValue = {
  asOf: string;
  stores: { storeCode: string; opening: number; sold: number; closing: number }[];
};

export type DailyCalls = {
  calls: number;
  connected: number;
  interested: number;
  bySalesperson: { name: string; calls: number; connected: number; interested: number }[];
};

export type DailyFollowups = {
  dueToday: number;
  overdue: number;
  byStore: { store: string; dueToday: number; overdue: number }[];
};

export type DailyCrm = {
  date: string;
  stores: DailyStore[];
  /** Time of the latest bill loaded into CRM, so the page can say how current sales are. */
  salesThrough: string | null;
  calls: DailyCalls;
  followups: DailyFollowups;
  /** Null when no stock report is available (CRM holds no stock of its own). */
  stockValue: DailyStockValue | null;
};

export const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** The day before or after, as YYYY-MM-DD. */
export const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

export async function getDailyCrm(date: string): Promise<DailyCrm> {
  if (!isDay(date)) throw new Error(`Invalid day: ${date}`);
  const monthStart = `${date.slice(0, 8)}01`;
  const [stores, walkIns, sales, through, calls, followups, totals, lines] = await Promise.all([
    query(sql`SELECT id, store_code, name FROM stores WHERE store_code IS NOT NULL ORDER BY store_code`),
    query(sql`
      SELECT store_id, count(*)::int AS walk_ins, COALESCE(sum(people), 0)::int AS people,
             count(*) FILTER (WHERE staff_converted OR pos_sale_id IS NOT NULL)::int AS converted
      FROM store_visits
      WHERE deleted_at IS NULL AND (visited_at AT TIME ZONE 'Asia/Kolkata')::date = ${date}::date
      GROUP BY store_id`),
    query(sql`
      SELECT store_id, count(*)::int AS bills, COALESCE(sum(bill_amount), 0)::float8 AS sales
      FROM sales WHERE (billed_at AT TIME ZONE 'Asia/Kolkata')::date = ${date}::date
      GROUP BY store_id`),
    query(sql`SELECT max(billed_at) AS through FROM sales`),
    query(sql`
      SELECT salesperson, count(*)::int AS calls,
             count(*) FILTER (WHERE outcome LIKE 'Connected%')::int AS connected,
             count(*) FILTER (WHERE outcome = 'Connected / interested')::int AS interested
      FROM marketing_calls WHERE called_at::date = ${date}::date
      GROUP BY salesperson ORDER BY calls DESC, salesperson`),
    query(sql`
      SELECT COALESCE(preferred_store, '') AS store,
             count(*) FILTER (WHERE followup_due::date = ${date}::date)::int AS due_today,
             count(*) FILTER (WHERE followup_due::date < ${date}::date)::int AS overdue
      FROM marketing_call_list_contacts
      WHERE followup_due IS NOT NULL AND followup_completed_at IS NULL AND followup_due::date <= ${date}::date
      GROUP BY 1 ORDER BY 1`),
    query(sql`
      SELECT store_id,
             COALESCE(sum(bill_amount) FILTER (WHERE (billed_at AT TIME ZONE 'Asia/Kolkata')::date = ${shiftDay(date, -1)}::date), 0)::float8 AS prev_sales,
             COALESCE(sum(bill_amount) FILTER (WHERE (billed_at AT TIME ZONE 'Asia/Kolkata')::date >= ${monthStart}::date), 0)::float8 AS mtd_sales
      FROM sales WHERE (billed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN LEAST(${monthStart}::date, ${shiftDay(date, -1)}::date) AND ${date}::date
      GROUP BY store_id`),
    // purc_value is the line's whole purchase value (Hemparshwa sums it per line), not a unit cost.
    query(sql`
      SELECT s.store_id, COALESCE(sum(li.qty), 0)::float8 AS units, COALESCE(sum(li.purc_value), 0)::float8 AS cost
      FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
      WHERE (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date = ${date}::date
      GROUP BY s.store_id`),
  ]);

  const byStore = <T extends Record<string, unknown>>(rows: T[]) => new Map(rows.map((r) => [num(r.store_id), r]));
  const w = byStore(walkIns);
  const s = byStore(sales);
  const t = byStore(totals);
  const l = byStore(lines);
  const callRows = calls.map((r) => ({ name: String(r.salesperson), calls: num(r.calls), connected: num(r.connected), interested: num(r.interested) }));
  const followupRows = followups.map((r) => ({ store: storeName(String(r.store)) || 'No store recorded', dueToday: num(r.due_today), overdue: num(r.overdue) }));

  return {
    date,
    stores: stores.map((st) => {
      const wi = w.get(num(st.id));
      const sa = s.get(num(st.id));
      return {
        storeCode: String(st.store_code),
        name: String(st.name),
        walkIns: num(wi?.walk_ins),
        people: num(wi?.people),
        converted: num(wi?.converted),
        bills: num(sa?.bills),
        sales: num(sa?.sales),
        units: num(l.get(num(st.id))?.units),
        soldCost: num(l.get(num(st.id))?.cost),
        prevSales: num(t.get(num(st.id))?.prev_sales),
        mtdSales: num(t.get(num(st.id))?.mtd_sales),
      };
    }),
    salesThrough: through[0]?.through ? new Date(str(through[0].through)!).toISOString() : null,
    calls: {
      calls: callRows.reduce((n, r) => n + r.calls, 0),
      connected: callRows.reduce((n, r) => n + r.connected, 0),
      interested: callRows.reduce((n, r) => n + r.interested, 0),
      bySalesperson: callRows,
    },
    followups: {
      dueToday: followupRows.reduce((n, r) => n + r.dueToday, 0),
      overdue: followupRows.reduce((n, r) => n + r.overdue, 0),
      byStore: followupRows,
    },
    stockValue: null,
  };
}
