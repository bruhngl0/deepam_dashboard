/**
 * Counter targets (drizzle/0037): each month's piece targets for groups of counters at MG Road and Jayanagar, and
 * the pieces those counters sold. Sold = pieces on the store's sale lines in the month (sales less returns), from
 * every vendor and whoever billed them, on lines that belong to a bill CRM counts (sale_id set: wholesale and
 * superseded exports are left out, as in every sales total). Rules: ./counter-rules.ts.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { normCode, parseRules, soldFor, type SoldRow } from './counter-rules';

const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));

export const TARGET_STORES = [{ code: 'MG_ROAD', name: 'MG Road' }, { code: 'JAYANAGAR', name: 'Jayanagar' }] as const;
export type TargetStore = (typeof TARGET_STORES)[number]['code'];
export const isTargetStore = (s: unknown): s is TargetStore => TARGET_STORES.some((t) => t.code === s);
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type CounterTarget = { id: number; storeCode: TargetStore; month: string; position: number; codes: string; assistants: string | null; target1: number; target2: number | null };

export async function targetsFor(month: string): Promise<CounterTarget[]> {
  const rows = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT id, store_code, month, position, codes, assistants, target_1, target_2 FROM counter_targets WHERE month = ${month} ORDER BY store_code, position, id`));
  return rows.map((r) => ({ id: Number(r.id), storeCode: r.store_code as TargetStore, month: String(r.month), position: Number(r.position), codes: String(r.codes),
    assistants: r.assistants === null ? null : String(r.assistants), target1: Number(r.target_1), target2: r.target_2 === null ? null : Number(r.target_2) }));
}

/** The latest month before `month` that has targets, to copy from. */
export async function previousTargetMonth(month: string): Promise<string | null> {
  const r = rowsOf<{ month: string }>(await db.execute(sql`SELECT max(month) AS month FROM counter_targets WHERE month < ${month}`))[0];
  return r?.month ?? null;
}

/** Pieces sold per counter code and tag price at the store in the month. */
export async function soldRows(store: TargetStore, from: string, to: string): Promise<SoldRow[]> {
  const rows = rowsOf<{ code: string; tag_price: string | null; qty: string }>(await db.execute(sql`
    SELECT COALESCE(NULLIF(trim(li.raw->>'category_id'), ''), NULLIF(trim(li.raw->>'Item Short Name'), ''), '') AS code,
           li.sales_rate AS tag_price, sum(li.qty) AS qty
    FROM sale_line_items li JOIN stores s ON s.id = li.store_id
    WHERE s.code = ${store} AND li.sale_id IS NOT NULL AND li.voucher_date_raw BETWEEN ${from} AND ${to}
    GROUP BY 1, 2`));
  // A return line can carry a negative rate; the band goes by the size of the price.
  return rows.map((r) => ({ code: normCode(r.code), tagPrice: Math.abs(Number(r.tag_price ?? 0)), qty: Number(r.qty ?? 0) }));
}

export type TargetResult = CounterTarget & { sold: number; byCode: [string, number][]; error: string | null };

export function evaluate(targets: CounterTarget[], rows: SoldRow[]): TargetResult[] {
  return targets.map((t) => {
    try {
      const { total, byCode } = soldFor(parseRules(t.codes), rows);
      return { ...t, sold: total, byCode: [...byCode], error: null };
    } catch (e) {
      return { ...t, sold: 0, byCode: [], error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Every counter's pieces at the store, for the "all counters" table. */
export function piecesByCode(rows: SoldRow[]): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.code || '—', (m.get(r.code || '—') ?? 0) + r.qty);
  return [...m].sort((a, b) => (Number(a[0]) || 999) - (Number(b[0]) || 999) || a[0].localeCompare(b[0]));
}

export type TargetInput = { codes: string; assistants: string | null; target1: number; target2: number | null };

/** Replaces the store's targets for the month with these rows, in this order. */
export async function saveTargets(store: TargetStore, month: string, rows: TargetInput[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM counter_targets WHERE store_code = ${store} AND month = ${month}`);
    for (const [i, r] of rows.entries()) {
      await tx.execute(sql`INSERT INTO counter_targets (store_code, month, position, codes, assistants, target_1, target_2)
        VALUES (${store}, ${month}, ${i + 1}, ${r.codes}, ${r.assistants}, ${r.target1}, ${r.target2})`);
    }
  });
}

export async function copyTargets(fromMonth: string, toMonth: string): Promise<void> {
  await db.execute(sql`INSERT INTO counter_targets (store_code, month, position, codes, assistants, target_1, target_2)
    SELECT store_code, ${toMonth}, position, codes, assistants, target_1, target_2 FROM counter_targets
    WHERE month = ${fromMonth} AND NOT EXISTS (SELECT 1 FROM counter_targets WHERE month = ${toMonth})`);
}
