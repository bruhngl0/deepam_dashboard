/**
 * Queries behind the Salespeople module (/crm/salespeople): everything a salesperson sold and served,
 * as the base for incentives. Reads the analytics database (migration/analytics/030_model.sql), where
 * each bill, walk-in, call and driver visit already carries the Salesperson ID (EMP-) its name matched.
 *
 * Two ways a bill is credited, both shown:
 *   - Billed by: the salesman printed on the bill (POS). Returns are the negative bills, credited the same way.
 *   - Served: the WalkTrack walk-in(s) a salesperson was tagged on, and the bill each walk-in led to.
 *     A walk-in served by two people counts in full for each.
 *
 * Period: IST days; store: the CRM store code (MG_ROAD…) from the master filter, mapped to analytics Store IDs.
 * "New customer" means the customer's first bill in the loaded sales history (from 1 May 2026).
 */

import { aq } from './db';
import { todayIst } from '@/lib/queries/daily';

export type SalesPeriod = { from: string; to: string; store: string | null };
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** From the CRM master filter's ?from=&to=&store=. Unset dates mean the whole loaded history through today. */
export function salesPeriod(sp: Record<string, string | string[] | undefined>): SalesPeriod {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const today = todayIst();
  const to = DAY.test(one(sp.to) ?? '') && one(sp.to)! <= today ? one(sp.to)! : today;
  const from = DAY.test(one(sp.from) ?? '') && one(sp.from)! <= to ? one(sp.from)! : '2000-01-01';
  const store = one(sp.store);
  return { from, to, store: store && /^[A-Z0-9_]{1,40}$/.test(store) ? store : null };
}

export type SalespersonStats = {
  empCode: string; name: string; storeCode: string | null; storeName: string | null;
  bills: number; grossSales: number; returns: number; returned: number; netSales: number; qty: number; discount: number;
  salesWithCost: number; cost: number; billsWithCustomer: number; customers: number; newCustomers: number; repeatCustomers: number;
  /** walkInsShared: of walkIns, those also tagged to another salesperson (each counts them in full). */
  walkIns: number; walkInsShared: number; walkInsConverted: number; walkInsBilled: number; walkInSales: number;
  driverVisits: number; driverBills: number; driverSales: number; calls: number; connected: number; interested: number;
};

// $1 from, $2 to, $3 CRM store code or null, $4 Salesperson ID or null.
const STATS_SQL = `
WITH st AS (SELECT store_code FROM analytics.dim_store WHERE crm_code = $3),
lines AS (SELECT bill_id, sum(cost) FILTER (WHERE cost > 0) AS cost, bool_and(cost > 0) AS all_cost FROM analytics.fact_bill_line GROUP BY 1),
first_bill AS (SELECT person_id, min(billed_at) AS first_at FROM analytics.fact_bill WHERE person_id IS NOT NULL AND amount > 0 GROUP BY 1),
b AS (
  SELECT b.*, l.cost, coalesce(l.all_cost, false) AS all_cost, fb.first_at
  FROM analytics.fact_bill b
  LEFT JOIN lines l USING (bill_id) LEFT JOIN first_bill fb USING (person_id)
  WHERE b.day BETWEEN $1 AND $2 AND ($3::text IS NULL OR b.store_code IN (SELECT store_code FROM st)) AND b.emp_code IS NOT NULL
    AND ($4::text IS NULL OR b.emp_code = $4)),
billed AS (
  SELECT emp_code,
    count(*) FILTER (WHERE amount > 0) AS bills,
    coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS gross_sales,
    count(*) FILTER (WHERE amount < 0) AS returns,
    coalesce(-sum(amount) FILTER (WHERE amount < 0), 0) AS returned,
    coalesce(sum(amount), 0) AS net_sales,
    coalesce(sum(qty) FILTER (WHERE amount > 0), 0) AS qty,
    coalesce(sum(discount) FILTER (WHERE amount > 0), 0) AS discount,
    coalesce(sum(amount) FILTER (WHERE amount > 0 AND all_cost), 0) AS sales_with_cost,
    coalesce(sum(cost) FILTER (WHERE amount > 0 AND all_cost), 0) AS cost,
    count(*) FILTER (WHERE amount > 0 AND person_id IS NOT NULL) AS bills_with_customer,
    count(DISTINCT person_id) FILTER (WHERE amount > 0) AS customers,
    count(DISTINCT person_id) FILTER (WHERE amount > 0 AND billed_at = first_at) AS new_customers
  FROM b GROUP BY 1),
repeat AS (
  SELECT emp_code, count(*) AS repeat_customers FROM (
    SELECT emp_code, person_id FROM b WHERE amount > 0 AND person_id IS NOT NULL GROUP BY 1, 2 HAVING count(DISTINCT day) > 1) x
  GROUP BY 1),
served AS (
  SELECT ws.emp_code, count(*) AS walk_ins, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics.fact_walkin_salesperson o WHERE o.walkin_id = w.walkin_id AND o.emp_code <> ws.emp_code)) AS shared, count(*) FILTER (WHERE w.converted) AS converted,
         count(*) FILTER (WHERE fb.amount > 0) AS billed, coalesce(sum(fb.amount) FILTER (WHERE fb.amount > 0), 0) AS sales
  FROM analytics.fact_walkin w JOIN analytics.fact_walkin_salesperson ws USING (walkin_id)
  LEFT JOIN analytics.fact_bill fb ON fb.bill_id = w.bill_id
  WHERE w.day BETWEEN $1 AND $2 AND ($3::text IS NULL OR w.store_code IN (SELECT store_code FROM st)) AND ($4::text IS NULL OR ws.emp_code = $4)
  GROUP BY 1),
driver AS (
  SELECT emp_code, count(*) AS visits, count(*) FILTER (WHERE bill_amount > 0) AS bills, coalesce(sum(bill_amount) FILTER (WHERE bill_amount > 0), 0) AS sales
  FROM analytics.fact_driver_visit
  WHERE day BETWEEN $1 AND $2 AND emp_code IS NOT NULL AND ($3::text IS NULL OR store_code IN (SELECT store_code FROM st)) AND ($4::text IS NULL OR emp_code = $4)
  GROUP BY 1),
calls AS (
  SELECT emp_code, count(*) AS calls, count(*) FILTER (WHERE connected) AS connected, count(*) FILTER (WHERE interested) AS interested
  FROM analytics.fact_call WHERE day BETWEEN $1 AND $2 AND emp_code IS NOT NULL AND ($4::text IS NULL OR emp_code = $4) GROUP BY 1)
SELECT sp.emp_code, sp.name, sp.store_code, ds.name AS store_name,
  coalesce(bl.bills, 0) AS bills, coalesce(bl.gross_sales, 0) AS gross_sales, coalesce(bl.returns, 0) AS returns, coalesce(bl.returned, 0) AS returned,
  coalesce(bl.net_sales, 0) AS net_sales, coalesce(bl.qty, 0) AS qty, coalesce(bl.discount, 0) AS discount,
  coalesce(bl.sales_with_cost, 0) AS sales_with_cost, coalesce(bl.cost, 0) AS cost, coalesce(bl.bills_with_customer, 0) AS bills_with_customer,
  coalesce(bl.customers, 0) AS customers, coalesce(bl.new_customers, 0) AS new_customers, coalesce(r.repeat_customers, 0) AS repeat_customers,
  coalesce(sv.walk_ins, 0) AS walk_ins, coalesce(sv.shared, 0) AS walk_ins_shared, coalesce(sv.converted, 0) AS walk_ins_converted, coalesce(sv.billed, 0) AS walk_ins_billed, coalesce(sv.sales, 0) AS walk_in_sales,
  coalesce(d.visits, 0) AS driver_visits, coalesce(d.bills, 0) AS driver_bills, coalesce(d.sales, 0) AS driver_sales,
  coalesce(c.calls, 0) AS calls, coalesce(c.connected, 0) AS connected, coalesce(c.interested, 0) AS interested
FROM analytics.dim_salesperson sp
LEFT JOIN analytics.dim_store ds ON ds.store_code = sp.store_code
LEFT JOIN billed bl USING (emp_code) LEFT JOIN repeat r USING (emp_code) LEFT JOIN served sv USING (emp_code)
LEFT JOIN driver d USING (emp_code) LEFT JOIN calls c USING (emp_code)
WHERE ($4::text IS NULL OR sp.emp_code = $4)
  AND ($4::text IS NOT NULL OR coalesce(bl.bills, 0) + coalesce(bl.returns, 0) + coalesce(sv.walk_ins, 0) + coalesce(d.visits, 0) + coalesce(c.calls, 0) > 0)
ORDER BY coalesce(bl.net_sales, 0) DESC, coalesce(sv.walk_ins, 0) DESC, sp.name`;

function toStats(r: Record<string, unknown>): SalespersonStats {
  return {
    empCode: String(r.emp_code), name: String(r.name), storeCode: s(r.store_code), storeName: s(r.store_name),
    bills: n(r.bills), grossSales: n(r.gross_sales), returns: n(r.returns), returned: n(r.returned), netSales: n(r.net_sales), qty: n(r.qty),
    discount: n(r.discount), salesWithCost: n(r.sales_with_cost), cost: n(r.cost), billsWithCustomer: n(r.bills_with_customer),
    customers: n(r.customers), newCustomers: n(r.new_customers), repeatCustomers: n(r.repeat_customers),
    walkIns: n(r.walk_ins), walkInsShared: n(r.walk_ins_shared), walkInsConverted: n(r.walk_ins_converted), walkInsBilled: n(r.walk_ins_billed), walkInSales: n(r.walk_in_sales),
    driverVisits: n(r.driver_visits), driverBills: n(r.driver_bills), driverSales: n(r.driver_sales),
    calls: n(r.calls), connected: n(r.connected), interested: n(r.interested),
  };
}

/** One row per salesperson with any bill, return, walk-in, driver visit or call in the period. Null: analytics not connected. */
export async function salespersonStats(period: SalesPeriod): Promise<SalespersonStats[] | null> {
  const rows = await aq<Record<string, unknown>>(STATS_SQL, [period.from, period.to, period.store, null]);
  return rows ? rows.map(toStats) : null;
}

export async function salespersonStatsFor(empCode: string, period: SalesPeriod): Promise<SalespersonStats | null> {
  const rows = await aq<Record<string, unknown>>(STATS_SQL, [period.from, period.to, period.store, empCode]);
  return rows?.[0] ? toStats(rows[0]) : null;
}

/** Bills in the period with no salesperson credited: blank on the bill, or a name not matched to a Salesperson ID.
 * unmatchedNames leaves out names deliberately kept unmatched (SELF). */
export async function uncreditedBills(period: SalesPeriod): Promise<{ bills: number; sales: number; unmatchedNames: number } | null> {
  const rows = await aq<Record<string, unknown>>(`
    SELECT count(*) AS bills, coalesce(sum(amount), 0) AS sales,
           (SELECT count(*) FROM analytics.salesperson_alias WHERE emp_code IS NULL AND matched_by IS NULL AND source = 'pos') AS unmatched
    FROM analytics.fact_bill b
    WHERE b.emp_code IS NULL AND b.day BETWEEN $1 AND $2
      AND ($3::text IS NULL OR b.store_code IN (SELECT store_code FROM analytics.dim_store WHERE crm_code = $3))`,
    [period.from, period.to, period.store]);
  const r = rows?.[0];
  return r ? { bills: n(r.bills), sales: n(r.sales), unmatchedNames: n(r.unmatched) } : null;
}

export type BillCoverage = {
  bills: number; sales: number; returns: number; value: number;
  matchedBills: number; matchedValue: number;
  /** Bills credited to no one, by the salesman name printed on them ('' = no name). Largest first. */
  uncredited: { name: string; bills: number; value: number }[];
};

/** How much of the sales sheet is credited to a salesperson, and what the rest says, for the period and store. */
export async function billCoverage(period: SalesPeriod): Promise<BillCoverage | null> {
  const rows = await aq<Record<string, unknown>>(`
    SELECT CASE WHEN b.emp_code IS NOT NULL THEN NULL ELSE upper(coalesce(trim(b.salesman_raw), '')) END AS name,
           count(*) AS bills, count(*) FILTER (WHERE b.amount > 0) AS sales, count(*) FILTER (WHERE b.amount < 0) AS returns,
           coalesce(sum(b.amount), 0) AS value
    FROM analytics.fact_bill b
    WHERE b.day BETWEEN $1 AND $2
      AND ($3::text IS NULL OR b.store_code IN (SELECT store_code FROM analytics.dim_store WHERE crm_code = $3))
    GROUP BY 1`,
    [period.from, period.to, period.store]);
  if (!rows) return null;
  const out: BillCoverage = { bills: 0, sales: 0, returns: 0, value: 0, matchedBills: 0, matchedValue: 0, uncredited: [] };
  for (const r of rows) {
    out.bills += n(r.bills); out.sales += n(r.sales); out.returns += n(r.returns); out.value += n(r.value);
    if (r.name === null) { out.matchedBills = n(r.bills); out.matchedValue = n(r.value); }
    else out.uncredited.push({ name: String(r.name), bills: n(r.bills), value: n(r.value) });
  }
  out.uncredited.sort((a, b) => b.bills - a.bills || (a.name ? 0 : 1) - (b.name ? 0 : 1));
  return out;
}

/** The loaded range of bills, for the "Showing …" line. */
export async function billBounds(): Promise<{ first: string | null; last: string | null }> {
  const rows = await aq<Record<string, unknown>>(`SELECT min(day)::text AS first, max(day)::text AS last FROM analytics.fact_bill`);
  return { first: s(rows?.[0]?.first), last: s(rows?.[0]?.last) };
}

export type SalespersonProfile = { empCode: string; name: string; storeCode: string | null; storeName: string | null; aliases: { source: string; display: string }[] };

export async function salespersonProfile(empCode: string): Promise<SalespersonProfile | null> {
  const rows = await aq<Record<string, unknown>>(`
    SELECT sp.emp_code, sp.name, sp.store_code, ds.name AS store_name,
           coalesce(json_agg(json_build_object('source', a.source, 'display', a.display) ORDER BY a.source, a.display) FILTER (WHERE a.key IS NOT NULL), '[]') AS aliases
    FROM analytics.dim_salesperson sp LEFT JOIN analytics.dim_store ds ON ds.store_code = sp.store_code
    LEFT JOIN analytics.salesperson_alias a ON a.emp_code = sp.emp_code
    WHERE sp.emp_code = $1 GROUP BY 1, 2, 3, 4`, [empCode]);
  const r = rows?.[0];
  if (!r) return null;
  return { empCode: String(r.emp_code), name: String(r.name), storeCode: s(r.store_code), storeName: s(r.store_name), aliases: r.aliases as SalespersonProfile['aliases'] };
}

export type MonthRow = { month: string; bills: number; returns: number; netSales: number; discount: number; salesWithCost: number; cost: number; customers: number; walkIns: number; walkInsShared: number; walkInsConverted: number; walkInsBilled: number };

/** Month by month for one salesperson (billed figures by bill date, walk-ins by visit date). */
export async function salespersonMonths(empCode: string, period: SalesPeriod): Promise<MonthRow[]> {
  const rows = await aq<Record<string, unknown>>(`
    WITH st AS (SELECT store_code FROM analytics.dim_store WHERE crm_code = $3),
    lines AS (SELECT bill_id, sum(cost) FILTER (WHERE cost > 0) AS cost, bool_and(cost > 0) AS all_cost FROM analytics.fact_bill_line GROUP BY 1),
    b AS (SELECT date_trunc('month', day)::date AS month, count(*) FILTER (WHERE amount > 0) AS bills, count(*) FILTER (WHERE amount < 0) AS returns,
                 sum(amount) AS net_sales, coalesce(sum(discount) FILTER (WHERE amount > 0), 0) AS discount,
                 coalesce(sum(amount) FILTER (WHERE amount > 0 AND l.all_cost), 0) AS sales_with_cost, coalesce(sum(l.cost) FILTER (WHERE amount > 0 AND l.all_cost), 0) AS cost,
                 count(DISTINCT person_id) FILTER (WHERE amount > 0) AS customers
          FROM analytics.fact_bill LEFT JOIN lines l USING (bill_id)
          WHERE emp_code = $4 AND day BETWEEN $1 AND $2 AND ($3::text IS NULL OR store_code IN (SELECT store_code FROM st)) GROUP BY 1),
    w AS (SELECT date_trunc('month', w.day)::date AS month, count(*) AS walk_ins, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics.fact_walkin_salesperson o WHERE o.walkin_id = w.walkin_id AND o.emp_code <> ws.emp_code)) AS shared, count(*) FILTER (WHERE w.converted) AS converted, count(*) FILTER (WHERE fb.amount > 0) AS billed
          FROM analytics.fact_walkin w JOIN analytics.fact_walkin_salesperson ws USING (walkin_id) LEFT JOIN analytics.fact_bill fb ON fb.bill_id = w.bill_id
          WHERE ws.emp_code = $4 AND w.day BETWEEN $1 AND $2 AND ($3::text IS NULL OR w.store_code IN (SELECT store_code FROM st)) GROUP BY 1)
    SELECT to_char(coalesce(b.month, w.month), 'YYYY-MM') AS month, b.bills, b.returns, b.net_sales, b.discount, b.sales_with_cost, b.cost, b.customers, w.walk_ins, w.shared, w.converted, w.billed
    FROM b FULL JOIN w USING (month) ORDER BY 1 DESC`, [period.from, period.to, period.store, empCode]);
  return (rows ?? []).map((r) => ({
    month: String(r.month), bills: n(r.bills), returns: n(r.returns), netSales: n(r.net_sales), discount: n(r.discount),
    salesWithCost: n(r.sales_with_cost), cost: n(r.cost), customers: n(r.customers), walkIns: n(r.walk_ins), walkInsShared: n(r.shared), walkInsConverted: n(r.converted), walkInsBilled: n(r.billed),
  }));
}

export type BillRow = {
  billId: number; day: string; voucher: string | null; storeName: string | null; personId: number | null; customerName: string | null; customerCode: string | null;
  firstBill: boolean; items: number; qty: number; amount: number; discount: number; cost: number | null;
  servedBy: string | null; leadChannel: string | null; driverCode: string | null;
};
export const BILL_PAGE_SIZE = 50;

/** One salesperson's bills (newest first), with how each one came in: the walk-in and who served it, a lead, a driver. */
/** `page` 0 returns every bill (the CSV export). */
export async function salespersonBills(empCode: string, period: SalesPeriod, page: number): Promise<{ rows: BillRow[]; total: number }> {
  const rows = await aq<Record<string, unknown>>(`
    WITH st AS (SELECT store_code FROM analytics.dim_store WHERE crm_code = $3),
    b AS (SELECT * FROM analytics.fact_bill WHERE emp_code = $4 AND day BETWEEN $1 AND $2 AND ($3::text IS NULL OR store_code IN (SELECT store_code FROM st)))
    SELECT b.bill_id, b.day::text AS day, b.voucher, coalesce(ds.name, b.store_code) AS store_name, b.person_id, p.name AS customer_name, p.customer_code,
           b.billed_at = (SELECT min(billed_at) FROM analytics.fact_bill f WHERE f.person_id = b.person_id AND f.amount > 0) AS first_bill,
           l.items, b.qty, b.amount, b.discount, CASE WHEN l.all_cost THEN l.cost END AS cost,
           (SELECT string_agg(DISTINCT sp.name, ', ') FROM analytics.fact_walkin w JOIN analytics.fact_walkin_salesperson ws USING (walkin_id)
              JOIN analytics.dim_salesperson sp ON sp.emp_code = ws.emp_code WHERE w.bill_id = b.bill_id) AS served_by,
           (SELECT max(w.driver_code) FROM analytics.fact_walkin w WHERE w.bill_id = b.bill_id) AS driver_code,
           (SELECT lt.channel FROM analytics.fact_lead_touch lt WHERE lt.person_id = b.person_id AND lt.touched_at <= b.billed_at
              ORDER BY lt.touched_at DESC LIMIT 1) AS lead_channel,
           count(*) OVER () AS total
    FROM b
    LEFT JOIN analytics.dim_store ds ON ds.store_code = b.store_code
    LEFT JOIN analytics.dim_person p ON p.person_id = b.person_id
    LEFT JOIN (SELECT bill_id, count(*) AS items, sum(cost) FILTER (WHERE cost > 0) AS cost, bool_and(cost > 0) AS all_cost
               FROM analytics.fact_bill_line GROUP BY 1) l ON l.bill_id = b.bill_id
    ORDER BY b.billed_at DESC, b.bill_id DESC
    ${page > 0 ? `LIMIT ${BILL_PAGE_SIZE}` : ''} OFFSET $5`, [period.from, period.to, period.store, empCode, Math.max(0, page - 1) * BILL_PAGE_SIZE]);
  return {
    total: n(rows?.[0]?.total),
    rows: (rows ?? []).map((r) => ({
      billId: n(r.bill_id), day: String(r.day), voucher: s(r.voucher), storeName: s(r.store_name), personId: r.person_id == null ? null : n(r.person_id),
      customerName: s(r.customer_name), customerCode: s(r.customer_code), firstBill: r.first_bill === true, items: n(r.items), qty: n(r.qty),
      amount: n(r.amount), discount: n(r.discount), cost: r.cost == null ? null : n(r.cost),
      servedBy: s(r.served_by), leadChannel: s(r.lead_channel), driverCode: s(r.driver_code),
    })),
  };
}
