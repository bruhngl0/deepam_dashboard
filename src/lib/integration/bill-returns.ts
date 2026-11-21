import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { allocateReturns, type BillLine } from './allocate-returns';

type LineRow = { sale_id: string; customer_id: string | null; barcode: string; day: string; qty: string; amount: string };
const rowsOf = <T>(result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as T[];

/**
 * Keeps every walk-in in step with what happened to its bill. Runs on each full reconcile, so after every
 * sales import:
 *   - a fully returned bill moves from `pos_sale_id` to `returned_sale_id`, so it no longer counts as a conversion;
 *   - if the return later disappears from the ERP data, the bill moves back;
 *   - a walk-in is never left on a return voucher.
 * WalkTrack reads the result through /api/integration/walk-ins and changes the walk-in's status.
 */
export async function syncBillReturns() {
  const lines = rowsOf<LineRow>(await db.execute(sql`
    SELECT li.sale_id::text, s.customer_id::text, li.barcode,
           to_char(s.billed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day, li.qty::text, li.net_amt::text AS amount
    FROM sale_line_items li JOIN sales s ON s.id = li.sale_id
    -- Every line of any bill holding a returned barcode: a bill is only fully returned if all its pieces came back.
    WHERE li.qty <> 0 AND li.sale_id IN (
      SELECT sale_id FROM sale_line_items
      WHERE barcode IN (SELECT barcode FROM sale_line_items WHERE qty < 0)
    )
  `)).map((r): BillLine => ({
    saleId: Number(r.sale_id),
    customerId: r.customer_id === null ? null : Number(r.customer_id),
    barcode: r.barcode,
    date: r.day,
    qty: Number(r.qty),
    amount: Number(r.amount ?? 0),
  }));
  const returned = allocateReturns(lines);

  await db.execute(sql`
    WITH x AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(returned)}::jsonb)
        AS x("saleId" bigint, "returnedAmount" numeric, "fullyReturned" boolean)
    ), target AS (
      SELECT s.id, COALESCE(x."returnedAmount", 0) AS amount, COALESCE(x."fullyReturned", false) AS is_full
      FROM sales s LEFT JOIN x ON x."saleId" = s.id
    )
    UPDATE sales s SET returned_amount = t.amount, fully_returned = t.is_full
    FROM target t
    WHERE t.id = s.id AND (s.returned_amount <> t.amount OR s.fully_returned <> t.is_full)
  `);
  await db.execute(sql`
    UPDATE store_visits sv SET returned_sale_id = sv.pos_sale_id, pos_sale_id = NULL, staff_converted = false, updated_at = now()
    FROM sales s WHERE s.id = sv.pos_sale_id AND s.fully_returned
  `);
  await db.execute(sql`
    UPDATE store_visits sv SET pos_sale_id = sv.returned_sale_id, returned_sale_id = NULL, staff_converted = true, updated_at = now()
    FROM sales s
    WHERE s.id = sv.returned_sale_id AND NOT s.fully_returned AND sv.pos_sale_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM store_visits taken WHERE taken.pos_sale_id = s.id)
  `);
  await db.execute(sql`
    UPDATE store_visits sv SET pos_sale_id = NULL, staff_converted = false, updated_at = now()
    FROM sales s WHERE s.id = sv.pos_sale_id AND s.bill_amount <= 0
  `);
}
