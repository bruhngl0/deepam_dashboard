/**
 * Item-level ("barcode-wise") sales importer — two-phase preview then
 * commit. (D-58)
 *
 * `saleId` is resolved by matching the line's `(voucherDateRaw, suffix of
 * voucherNoRaw)` against a bill-level `sales` row with the same IST calendar
 * date and the same numeric voucher suffix (leading zeros ignored either
 * way). Unmatched lines are inserted with `saleId = NULL`, not rejected —
 * they are real transactions (most likely Online-channel orders, or dates
 * outside what's been imported into `sales`), the same treatment D-51 gives
 * phone-less bills. Independent of `customers` (D-64): no lifecycle
 * recompute or materialized-view refresh runs here.
 */

import { createHash } from 'node:crypto';
import { sql, and, gte, lt } from 'drizzle-orm';
import { db, txDb } from '@/db';
import { importBatches, importRowsRejected, sales as salesTable, saleLineItems } from '@/db/schema';
import { IST_OFFSET_MINUTES } from '../excel';
import {
  parseSaleLineItemsWorkbook,
  voucherSuffix,
  type ParsedSaleLineItem,
  type SaleLineItemsParseResult,
} from '../parsers/sale-line-items';

/** Postgres caps a statement at 65535 parameters; stay well clear. (D-62) */
const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Strip leading zeros so '00670' and '670' compare equal. */
function normalizeSuffix(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== '' ? String(n) : raw.trim();
}

/** The IST calendar date (`YYYY-MM-DD`) a stored UTC `billed_at` instant falls on. (D-32) */
function istDateOf(billedAt: Date): string {
  const shifted = new Date(billedAt.getTime() + IST_OFFSET_MINUTES * 60_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate(),
  ).padStart(2, '0')}`;
}

export interface SaleLineItemsPreview {
  fileName: string;
  fileHash: string;
  sheetName: string;
  bannerText: string | null;
  summary: SaleLineItemsParseResult['summary'] & {
    duplicateRowsInFile: number;
    alreadyImported: boolean;
  };
  rejected: SaleLineItemsParseResult['rejected'];
  parsed: SaleLineItemsParseResult;
}

/** Phase 1 — parse, report. Writes nothing. (D-58) */
export async function previewSaleLineItemsImport(
  fileBuffer: Buffer,
  fileName: string,
  sheetName?: string,
): Promise<SaleLineItemsPreview> {
  const parsed = parseSaleLineItemsWorkbook(fileBuffer, sheetName);
  const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

  const seen = new Set<string>();
  let duplicateRowsInFile = 0;
  for (const row of parsed.rows) {
    const key = `${row.voucherDateRaw}|${row.voucherNoRaw}|${row.barcode}`;
    if (seen.has(key)) duplicateRowsInFile++;
    seen.add(key);
  }

  const priorBatch = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(sql`${importBatches.fileHash} = ${fileHash} AND ${importBatches.status} = 'committed'`)
    .limit(1);

  return {
    fileName,
    fileHash,
    sheetName: parsed.sheetName,
    bannerText: parsed.bannerText,
    summary: {
      ...parsed.summary,
      duplicateRowsInFile,
      alreadyImported: priorBatch.length > 0,
    },
    rejected: parsed.rejected,
    parsed,
  };
}

export interface SaleLineItemsCommitResult {
  batchId: string;
  rowsInserted: number;
  rowsUpdated: number;
  matchedToSale: number;
  unmatched: number;
  rejectedStored: number;
}

/** Phase 2 — write. One transaction. */
export async function commitSaleLineItemsImport(
  preview: SaleLineItemsPreview,
  uploadedBy?: string,
): Promise<SaleLineItemsCommitResult> {
  const { rows, rejected } = preview.parsed;
  const { db: tx, pool } = txDb();

  try {
    return await tx.transaction(async (t) => {
      const [batch] = await t
        .insert(importBatches)
        .values({
          sourceType: 'vendor',
          sourceKind: 'sale_items',
          fileName: preview.fileName,
          sheetName: preview.sheetName,
          fileHash: preview.fileHash,
          status: 'committed',
          rowsTotal: rows.length + rejected.length,
          rowsOk: rows.length,
          rowsRejected: rejected.length,
          rowsDuplicate: preview.summary.duplicateRowsInFile,
          uploadedBy: uploadedBy ?? null,
          committedAt: new Date(),
        })
        .returning({ id: importBatches.id });

      const batchId = batch.id;

      // ── Resolve saleId by (IST date, voucher suffix) ─────────────────────────
      // Widen the window a day on each side so no line falls outside it purely
      // from the IST/UTC boundary shift.
      const dates = rows.map((r) => r.voucherDateRaw);
      const minDate = dates.reduce((a, b) => (a < b ? a : b));
      const maxDate = dates.reduce((a, b) => (a > b ? a : b));
      const windowStart = new Date(`${minDate}T00:00:00.000Z`);
      windowStart.setUTCDate(windowStart.getUTCDate() - 1);
      const windowEnd = new Date(`${maxDate}T00:00:00.000Z`);
      windowEnd.setUTCDate(windowEnd.getUTCDate() + 2);

      const candidateSales = await t
        .select({ id: salesTable.id, voucherNo: salesTable.voucherNo, billedAt: salesTable.billedAt })
        .from(salesTable)
        .where(and(gte(salesTable.billedAt, windowStart), lt(salesTable.billedAt, windowEnd)));

      const saleIdByKey = new Map<string, number>();
      for (const s of candidateSales) {
        const key = `${istDateOf(s.billedAt)}|${normalizeSuffix(voucherSuffix(s.voucherNo))}`;
        saleIdByKey.set(key, s.id);
      }

      // ── Sale line items ────────────────────────────────────────────────────
      // Dedupe within the file so ON CONFLICT sees each identity key once.
      const byKey = new Map<string, ParsedSaleLineItem>();
      for (const row of rows) byKey.set(`${row.voucherDateRaw}|${row.voucherNoRaw}|${row.barcode}`, row);
      const uniqueRows = [...byKey.values()];

      let matchedToSale = 0;
      const lineValues = uniqueRows.map((row) => {
        const saleId =
          saleIdByKey.get(`${row.voucherDateRaw}|${normalizeSuffix(row.voucherNoRaw)}`) ?? null;
        if (saleId !== null) matchedToSale++;
        return {
          saleId,
          voucherDateRaw: row.voucherDateRaw,
          voucherNoRaw: row.voucherNoRaw,
          batchId,
          barcode: row.barcode,
          accountNameRaw: row.accountNameRaw,
          itemName: row.itemName,
          hsnCode: row.hsnCode,
          designNo: row.designNo,
          colorName: row.colorName,
          size: row.size,
          qty: row.qty === null ? null : String(row.qty),
          purcValue: row.purcValue === null ? null : String(row.purcValue),
          salesRate: row.salesRate === null ? null : String(row.salesRate),
          amount: row.amount === null ? null : String(row.amount),
          itemDiscAmt: row.itemDiscAmt === null ? null : String(row.itemDiscAmt),
          itemAmt: row.itemAmt === null ? null : String(row.itemAmt),
          addLessAmt: row.addLessAmt === null ? null : String(row.addLessAmt),
          netAmt: row.netAmt === null ? null : String(row.netAmt),
          taxableAmt: row.taxableAmt === null ? null : String(row.taxableAmt),
          sgstAmt: row.sgstAmt === null ? null : String(row.sgstAmt),
          cgstAmt: row.cgstAmt === null ? null : String(row.cgstAmt),
          igstAmt: row.igstAmt === null ? null : String(row.igstAmt),
          otherAddLessAmt: row.otherAddLessAmt === null ? null : String(row.otherAddLessAmt),
          amtWithTax: row.amtWithTax === null ? null : String(row.amtWithTax),
          salesAmt: row.salesAmt === null ? null : String(row.salesAmt),
          raw: row.raw,
        };
      });

      let rowsInserted = 0;
      let rowsUpdated = 0;
      for (const part of chunk(lineValues)) {
        const written = await t
          .insert(saleLineItems)
          .values(part)
          .onConflictDoUpdate({
            target: [saleLineItems.voucherDateRaw, saleLineItems.voucherNoRaw, saleLineItems.barcode],
            set: {
              saleId: sql`EXCLUDED.sale_id`,
              batchId: sql`EXCLUDED.batch_id`,
              accountNameRaw: sql`EXCLUDED.account_name_raw`,
              itemName: sql`EXCLUDED.item_name`,
              hsnCode: sql`EXCLUDED.hsn_code`,
              designNo: sql`EXCLUDED.design_no`,
              colorName: sql`EXCLUDED.color_name`,
              size: sql`EXCLUDED.size`,
              qty: sql`EXCLUDED.qty`,
              purcValue: sql`EXCLUDED.purc_value`,
              salesRate: sql`EXCLUDED.sales_rate`,
              amount: sql`EXCLUDED.amount`,
              itemDiscAmt: sql`EXCLUDED.item_disc_amt`,
              itemAmt: sql`EXCLUDED.item_amt`,
              addLessAmt: sql`EXCLUDED.add_less_amt`,
              netAmt: sql`EXCLUDED.net_amt`,
              taxableAmt: sql`EXCLUDED.taxable_amt`,
              sgstAmt: sql`EXCLUDED.sgst_amt`,
              cgstAmt: sql`EXCLUDED.cgst_amt`,
              igstAmt: sql`EXCLUDED.igst_amt`,
              otherAddLessAmt: sql`EXCLUDED.other_add_less_amt`,
              amtWithTax: sql`EXCLUDED.amt_with_tax`,
              salesAmt: sql`EXCLUDED.sales_amt`,
              raw: sql`EXCLUDED.raw`,
            },
          })
          // `xmax = 0` is true only for a row this statement actually inserted.
          .returning({ id: saleLineItems.id, wasInsert: sql<boolean>`(xmax = 0)` });
        for (const row of written) {
          if (row.wasInsert) rowsInserted++;
          else rowsUpdated++;
        }
      }

      // ── Rejected rows ──────────────────────────────────────────────────────
      if (rejected.length > 0) {
        for (const part of chunk(rejected)) {
          await t.insert(importRowsRejected).values(
            part.map((r) => ({
              batchId,
              rowNumber: r.rowNumber,
              raw: r.raw,
              errorCode: r.errorCode,
              errorMsg: r.errorMsg,
            })),
          );
        }
      }

      return {
        batchId,
        rowsInserted,
        rowsUpdated,
        matchedToSale,
        unmatched: uniqueRows.length - matchedToSale,
        rejectedStored: rejected.length,
      };
    });
  } finally {
    await pool.end();
  }
}
