/**
 * Reads for the incentives page: every salesperson's credited bills for the month (analytics database), each bill
 * line's stock age (CRM sale_line_items: sale date − inward date) and who is weekend staff.
 *
 * A salesperson's store for the month is where they billed the most (by sales) of MG Road and Jayanagar: the
 * analytics home store is MG Road for nearly everyone, Jayanagar staff included. Someone with no sales at either
 * store that month falls back to their home store, and is left out when that is neither.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { aq } from '@/lib/analytics/db';
import { computeIncentives, type IncentiveBill, type IncentivePerson, type IncentiveRow, type OldStockLine } from './compute';
import { isIncentiveStore } from './slabs';

const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));

/** "2026-10" → first and last day. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export async function weekendStaff(): Promise<Set<string>> {
  const rows = rowsOf<{ emp_code: string }>(await db.execute(sql`SELECT emp_code FROM salesperson_incentive_settings WHERE weekend_staff`));
  return new Set(rows.map((r) => r.emp_code));
}

export async function setWeekendStaff(empCode: string, on: boolean): Promise<void> {
  if (!/^EMP-[0-9]{4}$/.test(empCode)) throw new Error(`Not a Salesperson ID: ${empCode}`);
  await db.execute(sql`INSERT INTO salesperson_incentive_settings (emp_code, weekend_staff) VALUES (${empCode}, ${on})
    ON CONFLICT (emp_code) DO UPDATE SET weekend_staff = excluded.weekend_staff, updated_at = now()`);
}

/** Null: analytics not connected. */
export async function monthIncentives(month: string): Promise<IncentiveRow[] | null> {
  const { from, to } = monthRange(month);
  const people = await aq<{ emp_code: string; name: string; store_code: string | null }>(
    `SELECT emp_code, name, store_code FROM analytics.dim_salesperson ORDER BY name`);
  if (!people) return null;
  const bills = (await aq<{ bill_id: string; emp_code: string; person_id: string | null; amount: string; store_code: string | null }>(
    `SELECT bill_id, emp_code, person_id, amount, store_code FROM analytics.fact_bill WHERE emp_code IS NOT NULL AND day BETWEEN $1 AND $2`, [from, to])) ?? [];
  const ids = bills.map((b) => Number(b.bill_id));
  // Age bands as in ./slabs AGE_BANDS: 1 = 2–5 years, 2 = 5–10, 3 = 10 and more. A line with no inward date is new stock.
  const old = ids.length ? rowsOf<{ sale_id: string; band: number; amount: string }>(await db.execute(sql`
    SELECT sale_id, band, sum(coalesce(sales_amt, amount)) AS amount FROM (
      SELECT sale_id, sales_amt, amount,
        CASE WHEN purchase_date IS NULL OR purchase_date > voucher_date_raw - interval '2 years' THEN 0
             WHEN purchase_date > voucher_date_raw - interval '5 years' THEN 1
             WHEN purchase_date > voucher_date_raw - interval '10 years' THEN 2 ELSE 3 END AS band
      FROM sale_line_items WHERE sale_id = ANY(${`{${ids.join(',')}}`}::bigint[])) l
    WHERE band > 0 GROUP BY 1, 2`)) : [];
  const weekend = await weekendStaff();
  const salesAt = new Map<string, number>();
  for (const b of bills) if (Number(b.amount) > 0 && isIncentiveStore(b.store_code)) salesAt.set(`${b.emp_code}|${b.store_code}`, (salesAt.get(`${b.emp_code}|${b.store_code}`) ?? 0) + Number(b.amount));
  const storeOf = (p: { emp_code: string; store_code: string | null }) => {
    const mg = salesAt.get(`${p.emp_code}|STR-001`) ?? 0, jn = salesAt.get(`${p.emp_code}|STR-002`) ?? 0;
    return mg || jn ? (jn > mg ? 'STR-002' : 'STR-001') : isIncentiveStore(p.store_code) ? p.store_code : null;
  };
  const persons: IncentivePerson[] = people.flatMap((p) => {
    const store = storeOf(p);
    return store ? [{ empCode: p.emp_code, name: p.name, store, weekendStaff: weekend.has(p.emp_code) }] : [];
  });
  const billRows: IncentiveBill[] = bills.map((b) => ({ billId: Number(b.bill_id), empCode: b.emp_code, personId: b.person_id === null ? null : Number(b.person_id), amount: Number(b.amount) }));
  const oldRows: OldStockLine[] = old.map((l) => ({ billId: Number(l.sale_id), band: Number(l.band), amount: Number(l.amount) }));
  return computeIncentives(persons, billRows, oldRows).filter((r) => r.bills > 0 || r.business !== 0 || r.weekendStaff);
}
