/**
 * Builds CRM's bills, line items and customers from the copy of Hemparshwa's
 * sales lines (`hemparshwa_sales_lines`), so every screen keeps reading
 * `sales`, `sale_line_items` and `customers` as before.
 *
 * The Barcode Wise export is the one sales source. For every store and day it
 * covers, CRM's bills are exactly the sales documents in it:
 *
 *   - a bill is one store + voucher number + date + sales type. The POS runs
 *     several voucher series per store that reuse the same numbers, and returns
 *     have their own, so the number alone is not a bill. `voucher_no` here is
 *     the store's prefix, the number and the date (`BK01-00001@2026-05-01`),
 *     with the sales type appended when it is not a plain sale
 *     (`BK01-00001@2026-05-04-return`);
 *   - a return voucher is a bill with a negative amount, so sales are net of
 *     returns, the same figure Hemparshwa shows;
 *   - a bill built here earlier whose document is gone (import reset) is removed;
 *   - a bill from the old Sales Report import on a covered store and day is
 *     removed too: its number carries no date, so it cannot be matched.
 *
 * The export has no bill time, so a new bill is stamped 12:00 IST on its date.
 * Customers follow CRM's rule: identity is a valid Indian phone, nothing else.
 */

import { sql } from 'drizzle-orm';
import { normalizePhone } from '@/lib/phone';
import { reconcileStoreVisits } from './reconcile';

/** `import_batches.uploaded_by` for everything built here. */
export const HEMPARSHWA_USER = 'hemparshwa-os';

export interface ProjectionResult {
  bills: number;
  billsAdded: number;
  billsRemoved: number;
  /** Removed bills that came from the old Sales Report import. */
  legacyBillsRemoved: number;
  lineItems: number;
  customersTouched: number;
  /** Lines whose Store ID matches no CRM store; they are not billed. */
  unmappedStoreLines: number;
  visitsReconciled: number;
}

const count = (result: { rows: unknown[] }) => Number((result.rows[0] as { n: number | string }).n);

export async function projectHemparshwaSales(): Promise<ProjectionResult> {
  const { db, txDb } = await import('@/db');
  const { db: tx, pool } = txDb();
  let result: ProjectionResult;

  try {
    result = await tx.transaction(async (t) => {
      // ── Batches: one per Hemparshwa import ───────────────────────────────────
      await t.execute(sql`
        WITH made AS (
          INSERT INTO import_batches (source_type, source_kind, file_name, file_hash, file_url, status, rows_total, rows_ok, uploaded_by, committed_at)
          SELECT 'existing', 'sale', i.file_name, i.file_sha256, 'hemparshwa:' || i.import_id, 'committed', i.rows_imported, i.rows_synced, ${HEMPARSHWA_USER}, i.imported_at
          FROM hemparshwa_imports i WHERE i.batch_id IS NULL
          RETURNING id, file_url
        )
        UPDATE hemparshwa_imports i SET batch_id = made.id FROM made WHERE made.file_url = 'hemparshwa:' || i.import_id
      `);

      // ── Phones → CRM identity ────────────────────────────────────────────────
      const phones = (await t.execute(sql`SELECT DISTINCT customer_phone AS phone FROM hemparshwa_sales_lines WHERE customer_phone IS NOT NULL`))
        .rows as { phone: string }[];
      const identities = phones.flatMap(({ phone }) => {
        const p = normalizePhone(phone);
        return p.ok ? [{ phone, e164: p.e164, national: p.national }] : [];
      });
      await t.execute(sql`CREATE TEMP TABLE hp_phone (phone text PRIMARY KEY, e164 text NOT NULL, national text NOT NULL) ON COMMIT DROP`);
      await t.execute(sql`
        INSERT INTO hp_phone SELECT x.phone, x.e164, x.national
        FROM jsonb_to_recordset(${JSON.stringify(identities)}::jsonb) AS x(phone text, e164 text, national text)
      `);

      // ── The bills the copy describes ─────────────────────────────────────────
      await t.execute(sql`
        CREATE TEMP TABLE hp_bills ON COMMIT DROP AS
        SELECT st.id AS store_id,
               COALESCE(st.voucher_prefix, st.store_code || '-') || l.invoice_id || '@' || l.invoice_date || CASE WHEN l.sales_type IN ('', 'sales') THEN '' ELSE '-' || l.sales_type END AS voucher_no,
               l.invoice_id,
               l.invoice_date AS bill_date,
               ((l.invoice_date + time '12:00') AT TIME ZONE 'Asia/Kolkata') AS billed_at,
               min(i.batch_id::text)::uuid AS batch_id,
               min(p.e164) AS e164,
               max(l.customer_name) AS customer_name,
               max(l.customer_phone) AS phone_raw,
               sum(l.quantity) AS qty,
               sum(l.net_amount) AS bill_amount,
               sum((l.details->>'taxable_amount')::numeric) AS taxable_amount,
               sum(l.discount) AS item_disc_amount,
               min(l.salesperson) AS salesman_code,
               count(*) AS lines
        FROM hemparshwa_sales_lines l
        JOIN hemparshwa_imports i ON i.import_id = l.import_id
        JOIN stores st ON st.store_code = l.store_id
        LEFT JOIN hp_phone p ON p.phone = l.customer_phone
        GROUP BY st.id, st.voucher_prefix, st.store_code, l.invoice_id, l.invoice_date, l.sales_type
      `);
      await t.execute(sql`CREATE UNIQUE INDEX ON hp_bills (voucher_no)`);

      // ── Customers (same upsert rules as the Sales Report import, D-24) ────────
      const customers = await t.execute(sql`
        INSERT INTO customers (phone_e164, phone_national, full_name, name_source, first_seen_at, last_seen_at)
        SELECT b.e164, min(p.national), max(b.customer_name),
               CASE WHEN max(b.customer_name) IS NOT NULL THEN 'existing' END, min(b.billed_at), max(b.billed_at)
        FROM hp_bills b JOIN hp_phone p ON p.e164 = b.e164
        GROUP BY b.e164
        ON CONFLICT (phone_e164) DO UPDATE SET
          full_name = CASE WHEN EXCLUDED.full_name IS NOT NULL
                            AND name_trust_rank(EXCLUDED.name_source) >= name_trust_rank(customers.name_source)
                           THEN EXCLUDED.full_name ELSE customers.full_name END,
          name_source = CASE WHEN EXCLUDED.full_name IS NOT NULL
                              AND name_trust_rank(EXCLUDED.name_source) >= name_trust_rank(customers.name_source)
                             THEN EXCLUDED.name_source ELSE customers.name_source END,
          first_seen_at = LEAST(customers.first_seen_at, EXCLUDED.first_seen_at),
          last_seen_at = GREATEST(customers.last_seen_at, EXCLUDED.last_seen_at),
          updated_at = now()
        RETURNING id
      `);

      // ── Bills that no longer belong ──────────────────────────────────────────
      await t.execute(sql`
        CREATE TEMP TABLE hp_doomed ON COMMIT DROP AS
        SELECT s.id, (b.uploaded_by IS DISTINCT FROM ${HEMPARSHWA_USER}) AS legacy
        FROM sales s JOIN import_batches b ON b.id = s.batch_id
        WHERE NOT EXISTS (SELECT 1 FROM hp_bills d WHERE d.voucher_no = s.voucher_no)
          AND (b.uploaded_by = ${HEMPARSHWA_USER}
               OR EXISTS (SELECT 1 FROM hp_bills c
                          WHERE c.store_id = s.store_id AND c.bill_date = (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date))
      `);
      const billsRemoved = count(await t.execute(sql`SELECT count(*) AS n FROM hp_doomed`));
      const legacyBillsRemoved = count(await t.execute(sql`SELECT count(*) AS n FROM hp_doomed WHERE legacy`));
      await t.execute(sql`UPDATE store_visits SET pos_sale_id = NULL, updated_at = now() WHERE pos_sale_id IN (SELECT id FROM hp_doomed)`);
      await t.execute(sql`UPDATE sale_line_items SET sale_id = NULL WHERE sale_id IN (SELECT id FROM hp_doomed)`);
      await t.execute(sql`DELETE FROM sales WHERE id IN (SELECT id FROM hp_doomed)`);

      // ── Bills ────────────────────────────────────────────────────────────────
      const written = await t.execute(sql`
        INSERT INTO sales (voucher_no, batch_id, store_id, billed_at, customer_id, customer_name_raw, phone_raw,
                           qty, bill_amount, taxable_amount, item_disc_amount, salesman_code, raw)
        SELECT b.voucher_no, b.batch_id, b.store_id, b.billed_at, c.id, b.customer_name, b.phone_raw,
               b.qty, b.bill_amount, b.taxable_amount, b.item_disc_amount, b.salesman_code,
               jsonb_build_object('source', 'hemparshwa', 'invoice_id', b.invoice_id, 'lines', b.lines)
        FROM hp_bills b LEFT JOIN customers c ON c.phone_e164 = b.e164
        ON CONFLICT (voucher_no) DO UPDATE SET
          batch_id = EXCLUDED.batch_id, store_id = EXCLUDED.store_id, customer_id = EXCLUDED.customer_id,
          customer_name_raw = EXCLUDED.customer_name_raw, phone_raw = EXCLUDED.phone_raw, qty = EXCLUDED.qty,
          bill_amount = EXCLUDED.bill_amount, taxable_amount = EXCLUDED.taxable_amount,
          item_disc_amount = EXCLUDED.item_disc_amount, salesman_code = EXCLUDED.salesman_code,
          billed_at = EXCLUDED.billed_at, raw = EXCLUDED.raw
        RETURNING (xmax = 0) AS added
      `);
      const billsAdded = (written.rows as { added: boolean }[]).filter((r) => r.added).length;

      // ── Line items ───────────────────────────────────────────────────────────
      await t.execute(sql`
        DELETE FROM sale_line_items WHERE batch_id IN (SELECT id FROM import_batches WHERE uploaded_by = ${HEMPARSHWA_USER})
      `);
      const lineItems = await t.execute(sql`
        INSERT INTO sale_line_items (sale_id, voucher_date_raw, voucher_no_raw, batch_id, barcode, account_name_raw, item_name,
                                     color_name, size, qty, purc_value, sales_rate, amount, item_disc_amt, item_amt, net_amt,
                                     taxable_amt, sgst_amt, cgst_amt, igst_amt, sales_amt, raw)
        SELECT min(s.id), l.invoice_date, l.invoice_id, min(i.batch_id::text)::uuid, l.sku_code, max(l.customer_name),
               max(COALESCE(l.subcategory, l.sku_name)), max(l.details->>'colour'), max(l.details->>'size'),
               sum(l.quantity), sum((l.details->>'purchase_value')::numeric), max(l.selling_price),
               sum((l.details->>'total_amount')::numeric), sum(l.discount), sum((l.details->>'item_amount')::numeric),
               sum(l.net_amount), sum((l.details->>'taxable_amount')::numeric), sum((l.details->>'sgst_amount')::numeric),
               sum((l.details->>'cgst_amount')::numeric), sum((l.details->>'igst_amount')::numeric), sum(l.net_amount),
               (jsonb_agg(l.details))->0
        FROM hemparshwa_sales_lines l
        JOIN hemparshwa_imports i ON i.import_id = l.import_id
        JOIN stores st ON st.store_code = l.store_id
        JOIN sales s ON s.voucher_no = COALESCE(st.voucher_prefix, st.store_code || '-') || l.invoice_id || '@' || l.invoice_date || CASE WHEN l.sales_type IN ('', 'sales') THEN '' ELSE '-' || l.sales_type END
        GROUP BY l.invoice_date, l.invoice_id, l.sku_code
        ON CONFLICT (voucher_date_raw, voucher_no_raw, barcode) DO UPDATE SET
          sale_id = EXCLUDED.sale_id, batch_id = EXCLUDED.batch_id, account_name_raw = EXCLUDED.account_name_raw,
          item_name = EXCLUDED.item_name, color_name = EXCLUDED.color_name, size = EXCLUDED.size, qty = EXCLUDED.qty,
          purc_value = EXCLUDED.purc_value, sales_rate = EXCLUDED.sales_rate, amount = EXCLUDED.amount,
          item_disc_amt = EXCLUDED.item_disc_amt, item_amt = EXCLUDED.item_amt, net_amt = EXCLUDED.net_amt,
          taxable_amt = EXCLUDED.taxable_amt, sgst_amt = EXCLUDED.sgst_amt, cgst_amt = EXCLUDED.cgst_amt,
          igst_amt = EXCLUDED.igst_amt, sales_amt = EXCLUDED.sales_amt, raw = EXCLUDED.raw
        RETURNING id
      `);

      // A batch whose import left Hemparshwa has nothing filed under it any more.
      await t.execute(sql`
        UPDATE import_batches b SET status = 'rolled_back'
        WHERE b.uploaded_by = ${HEMPARSHWA_USER} AND b.status = 'committed'
          AND NOT EXISTS (SELECT 1 FROM hemparshwa_imports i WHERE i.batch_id = b.id)
      `);

      const unmappedStoreLines = count(await t.execute(sql`
        SELECT count(*) AS n FROM hemparshwa_sales_lines l WHERE NOT EXISTS (SELECT 1 FROM stores st WHERE st.store_code = l.store_id)
      `));
      const bills = count(await t.execute(sql`SELECT count(*) AS n FROM hp_bills`));

      // From scratch, as after every sales import. (D-38)
      await t.execute(sql`SELECT recompute_customer_lifecycle()`);

      return {
        bills, billsAdded, billsRemoved, legacyBillsRemoved, lineItems: lineItems.rows.length,
        customersTouched: customers.rows.length, unmappedStoreLines, visitsReconciled: 0,
      };
    });
  } finally {
    await pool.end();
  }

  // Outside the transaction: CONCURRENTLY is illegal inside one. (D-61)
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution`);
  result.visitsReconciled = await reconcileStoreVisits();
  return result;
}
