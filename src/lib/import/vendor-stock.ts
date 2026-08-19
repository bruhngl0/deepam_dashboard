/**
 * Vendor stock ledger importer — two-phase preview then commit. (D-58)
 *
 * Re-uploading the same reporting period is an upsert, not a duplicate: a
 * barcode's figures can be corrected in a later export of the same window
 * (`(barcode, period_from, period_to)` is the natural key, D-59-style).
 * Independent of `customers`/`sales` (D-64) — no lifecycle recompute or
 * materialized-view refresh runs here.
 */

import { createHash } from 'node:crypto';
import { sql, inArray } from 'drizzle-orm';
import { db, txDb } from '@/db';
import { importBatches, importRowsRejected, vendors as vendorsTable, vendorStockLedger } from '@/db/schema';
import {
  parseVendorStockWorkbook,
  type ParsedVendorStockRow,
  type VendorStockParseResult,
} from '../parsers/vendor-stock';

/** Postgres caps a statement at 65535 parameters; stay well clear. (D-62) */
const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface VendorStockPreview {
  fileName: string;
  fileHash: string;
  sheetName: string;
  bannerText: string | null;
  summary: VendorStockParseResult['summary'] & {
    periodFrom: string | null;
    periodTo: string | null;
    duplicateRowsInFile: number;
    alreadyImported: boolean;
  };
  rejected: VendorStockParseResult['rejected'];
  parsed: VendorStockParseResult;
}

/** Phase 1 — parse, report. Writes nothing. (D-58) */
export async function previewVendorStockImport(
  fileBuffer: Buffer,
  fileName: string,
  sheetName?: string,
): Promise<VendorStockPreview> {
  const parsed = parseVendorStockWorkbook(fileBuffer, sheetName);
  const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

  const seen = new Set<string>();
  let duplicateRowsInFile = 0;
  for (const row of parsed.rows) {
    const key = `${row.barcode}|${row.periodFrom}|${row.periodTo}`;
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
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      duplicateRowsInFile,
      alreadyImported: priorBatch.length > 0,
    },
    rejected: parsed.rejected,
    parsed,
  };
}

export interface VendorStockCommitResult {
  batchId: string;
  vendorsTouched: number;
  rowsInserted: number;
  rowsUpdated: number;
  rejectedStored: number;
}

/** Phase 2 — write. One transaction. */
export async function commitVendorStockImport(
  preview: VendorStockPreview,
  uploadedBy?: string,
): Promise<VendorStockCommitResult> {
  const { rows, rejected } = preview.parsed;
  const { db: tx, pool } = txDb();

  try {
    return await tx.transaction(async (t) => {
      const [batch] = await t
        .insert(importBatches)
        .values({
          sourceType: 'vendor',
          sourceKind: 'vendor_stock',
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

      // ── Vendors ────────────────────────────────────────────────────────────
      const vendorNames = [...new Set(rows.map((r) => r.vendorName))];
      for (const part of chunk(vendorNames)) {
        await t
          .insert(vendorsTable)
          .values(part.map((name) => ({ name })))
          .onConflictDoNothing({ target: vendorsTable.name });
      }

      const vendorIdByName = new Map<string, number>();
      for (const part of chunk(vendorNames, 1000)) {
        const found = await t
          .select({ id: vendorsTable.id, name: vendorsTable.name })
          .from(vendorsTable)
          .where(inArray(vendorsTable.name, part));
        for (const v of found) vendorIdByName.set(v.name, v.id);
      }

      // ── Vendor stock ledger ────────────────────────────────────────────────
      // Dedupe within the file so ON CONFLICT sees each identity key once.
      const byKey = new Map<string, ParsedVendorStockRow>();
      for (const row of rows) {
        byKey.set(`${row.barcode}|${row.periodFrom}|${row.periodTo}`, row);
      }
      const uniqueRows = [...byKey.values()];

      const ledgerValues = uniqueRows.map((row) => ({
        vendorId: vendorIdByName.get(row.vendorName)!,
        batchId,
        barcode: row.barcode,
        itemName: row.itemName,
        itemGroupName: row.itemGroupName,
        compSize: row.compSize,
        freshOrDefective: row.freshOrDefective,
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
        opQty: row.opQty === null ? null : String(row.opQty),
        opAmt: row.opAmt === null ? null : String(row.opAmt),
        purcQty: row.purcQty === null ? null : String(row.purcQty),
        purcAmt: row.purcAmt === null ? null : String(row.purcAmt),
        prQty: row.prQty === null ? null : String(row.prQty),
        prAmt: row.prAmt === null ? null : String(row.prAmt),
        netPurcQty: row.netPurcQty === null ? null : String(row.netPurcQty),
        netPurcAmt: row.netPurcAmt === null ? null : String(row.netPurcAmt),
        inQty: row.inQty === null ? null : String(row.inQty),
        inAmt: row.inAmt === null ? null : String(row.inAmt),
        outQty: row.outQty === null ? null : String(row.outQty),
        outAmt: row.outAmt === null ? null : String(row.outAmt),
        inTransitQty: row.inTransitQty === null ? null : String(row.inTransitQty),
        inTransitAmt: row.inTransitAmt === null ? null : String(row.inTransitAmt),
        salesQty: row.salesQty === null ? null : String(row.salesQty),
        salesAmt: row.salesAmt === null ? null : String(row.salesAmt),
        srQty: row.srQty === null ? null : String(row.srQty),
        srAmt: row.srAmt === null ? null : String(row.srAmt),
        netSalesQty: row.netSalesQty === null ? null : String(row.netSalesQty),
        netSalesAmt: row.netSalesAmt === null ? null : String(row.netSalesAmt),
        clQty: row.clQty === null ? null : String(row.clQty),
        clAmt: row.clAmt === null ? null : String(row.clAmt),
        clMrp: row.clMrp === null ? null : String(row.clMrp),
        raw: row.raw,
      }));

      let rowsInserted = 0;
      let rowsUpdated = 0;
      for (const part of chunk(ledgerValues)) {
        const inserted = await t
          .insert(vendorStockLedger)
          .values(part)
          .onConflictDoUpdate({
            target: [
              vendorStockLedger.barcode,
              vendorStockLedger.periodFrom,
              vendorStockLedger.periodTo,
            ],
            set: {
              vendorId: sql`EXCLUDED.vendor_id`,
              batchId: sql`EXCLUDED.batch_id`,
              itemName: sql`EXCLUDED.item_name`,
              itemGroupName: sql`EXCLUDED.item_group_name`,
              compSize: sql`EXCLUDED.comp_size`,
              freshOrDefective: sql`EXCLUDED.fresh_or_defective`,
              opQty: sql`EXCLUDED.op_qty`,
              opAmt: sql`EXCLUDED.op_amt`,
              purcQty: sql`EXCLUDED.purc_qty`,
              purcAmt: sql`EXCLUDED.purc_amt`,
              prQty: sql`EXCLUDED.pr_qty`,
              prAmt: sql`EXCLUDED.pr_amt`,
              netPurcQty: sql`EXCLUDED.net_purc_qty`,
              netPurcAmt: sql`EXCLUDED.net_purc_amt`,
              inQty: sql`EXCLUDED.in_qty`,
              inAmt: sql`EXCLUDED.in_amt`,
              outQty: sql`EXCLUDED.out_qty`,
              outAmt: sql`EXCLUDED.out_amt`,
              inTransitQty: sql`EXCLUDED.in_transit_qty`,
              inTransitAmt: sql`EXCLUDED.in_transit_amt`,
              salesQty: sql`EXCLUDED.sales_qty`,
              salesAmt: sql`EXCLUDED.sales_amt`,
              srQty: sql`EXCLUDED.sr_qty`,
              srAmt: sql`EXCLUDED.sr_amt`,
              netSalesQty: sql`EXCLUDED.net_sales_qty`,
              netSalesAmt: sql`EXCLUDED.net_sales_amt`,
              clQty: sql`EXCLUDED.cl_qty`,
              clAmt: sql`EXCLUDED.cl_amt`,
              clMrp: sql`EXCLUDED.cl_mrp`,
              raw: sql`EXCLUDED.raw`,
            },
          })
          // `xmax = 0` is true only for a row this statement actually inserted —
          // an UPDATE always sets xmax, so this is how insert/update are told
          // apart when every row in the batch always affects one either way.
          .returning({ id: vendorStockLedger.id, wasInsert: sql<boolean>`(xmax = 0)` });
        for (const row of inserted) {
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
        vendorsTouched: vendorNames.length,
        rowsInserted,
        rowsUpdated,
        rejectedStored: rejected.length,
      };
    });
  } finally {
    await pool.end();
  }
}
