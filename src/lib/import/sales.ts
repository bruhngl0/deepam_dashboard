/**
 * Sales importer — two-phase preview then commit. (D-58)
 *
 * Nothing unreviewed ever reaches the canonical tables: `preview` parses and
 * reports, `commit` writes in a single transaction. Re-importing the same file
 * is a no-op because `sales.voucher_no` and `customers.phone_e164` are natural
 * keys. (D-59, D-60)
 */

import { createHash } from 'node:crypto';
import { sql, eq, inArray } from 'drizzle-orm';
import { db, txDb } from '@/db';
import {
  stores as storesTable,
  importBatches,
  importRowsRejected,
  customers as customersTable,
  sales as salesTable,
} from '@/db/schema';
import { parseSalesWorkbook, type ParsedSale, type SalesParseResult } from '../parsers/sales';

/** Postgres caps a statement at 65535 parameters; stay well clear. (D-62) */
const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface SalesPreview {
  fileName: string;
  fileHash: string;
  sheetName: string;
  bannerText: string | null;
  summary: SalesParseResult['summary'] & {
    /** Voucher prefixes with no matching store — blocks the commit. */
    unknownPrefixes: string[];
    storeBreakdown: { store: string; prefix: string; bills: number; revenue: number }[];
    dateRange: { from: string; to: string } | null;
    duplicateVouchersInFile: number;
    alreadyImported: boolean;
  };
  rejected: SalesParseResult['rejected'];
  parsed: SalesParseResult;
}

/**
 * Phase 1 — parse, resolve stores, report. Writes nothing. (D-58)
 */
export async function previewSalesImport(
  fileBuffer: Buffer,
  fileName: string,
  sheetName?: string,
): Promise<SalesPreview> {
  const parsed = parseSalesWorkbook(fileBuffer, sheetName);
  const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

  const stores = await db.select().from(storesTable);
  const byPrefix = new Map(
    stores.filter((s) => s.voucherPrefix).map((s) => [s.voucherPrefix!, s]),
  );

  const unknownPrefixes = Object.keys(parsed.summary.byPrefix).filter(
    (p) => !byPrefix.has(p),
  );

  const storeBreakdown = Object.entries(parsed.summary.byPrefix).map(
    ([prefix, agg]) => ({
      store: byPrefix.get(prefix)?.name ?? '(unmapped)',
      prefix,
      bills: agg.bills,
      revenue: agg.revenue,
    }),
  );

  const timestamps = parsed.rows.map((r) => r.billedAt.getTime());
  const dateRange = timestamps.length
    ? {
        from: new Date(Math.min(...timestamps)).toISOString().slice(0, 10),
        to: new Date(Math.max(...timestamps)).toISOString().slice(0, 10),
      }
    : null;

  const seen = new Set<string>();
  let duplicateVouchersInFile = 0;
  for (const row of parsed.rows) {
    if (seen.has(row.voucherNo)) duplicateVouchersInFile++;
    seen.add(row.voucherNo);
  }

  // Warn, don't block — the commit is idempotent either way. (D-57)
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
      unknownPrefixes,
      storeBreakdown,
      dateRange,
      duplicateVouchersInFile,
      alreadyImported: priorBatch.length > 0,
    },
    rejected: parsed.rejected,
    parsed,
  };
}

export interface SalesCommitResult {
  batchId: string;
  customersInserted: number;
  salesInserted: number;
  salesSkipped: number;
  rejectedStored: number;
}

/**
 * Phase 2 — write. One transaction; the derived layer is refreshed after it
 * commits, because REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a
 * transaction block. (D-60, D-61)
 */
export async function commitSalesImport(
  preview: SalesPreview,
  uploadedBy?: string,
): Promise<SalesCommitResult> {
  if (preview.summary.unknownPrefixes.length > 0) {
    throw new Error(
      `Unmapped voucher prefixes: ${preview.summary.unknownPrefixes.join(', ')}. ` +
        `Add them to stores.voucher_prefix before importing.`,
    );
  }

  const { rows, rejected } = preview.parsed;
  const { db: tx, pool } = txDb();

  let result: SalesCommitResult;

  try {
    result = await tx.transaction(async (t) => {
      const stores = await t.select().from(storesTable);
      const storeIdByPrefix = new Map(
        stores.filter((s) => s.voucherPrefix).map((s) => [s.voucherPrefix!, s.id]),
      );

      const [batch] = await t
        .insert(importBatches)
        .values({
          sourceType: 'existing', // sales are not a lead channel
          sourceKind: 'sale',
          fileName: preview.fileName,
          sheetName: preview.sheetName,
          fileHash: preview.fileHash,
          status: 'committed',
          rowsTotal: rows.length + rejected.length,
          rowsOk: rows.length,
          rowsRejected: rejected.length,
          rowsDuplicate: preview.summary.duplicateVouchersInFile,
          uploadedBy: uploadedBy ?? null,
          committedAt: new Date(),
        })
        .returning({ id: importBatches.id });

      const batchId = batch.id;

      // ── Customers ──────────────────────────────────────────────────────────
      // Dedupe by phone first: 105 phones have more than one bill this week,
      // and Postgres refuses an ON CONFLICT DO UPDATE that touches the same row
      // twice in one statement.
      const byPhone = new Map<
        string,
        { national: string; name: string | null; firstSeen: Date; lastSeen: Date }
      >();

      for (const row of rows) {
        if (!row.phoneE164) continue;
        const existing = byPhone.get(row.phoneE164);
        if (!existing) {
          byPhone.set(row.phoneE164, {
            national: row.phoneNational!,
            name: row.customerNameRaw,
            firstSeen: row.billedAt,
            lastSeen: row.billedAt,
          });
        } else {
          if (row.billedAt < existing.firstSeen) existing.firstSeen = row.billedAt;
          if (row.billedAt > existing.lastSeen) existing.lastSeen = row.billedAt;
          existing.name ??= row.customerNameRaw;
        }
      }

      const customerValues = [...byPhone.entries()].map(([e164, c]) => ({
        phoneE164: e164,
        phoneNational: c.national,
        fullName: c.name,
        nameSource: c.name ? 'existing' : null,
        firstSeenAt: c.firstSeen,
        lastSeenAt: c.lastSeen,
      }));

      for (const part of chunk(customerValues)) {
        await t
          .insert(customersTable)
          .values(part)
          .onConflictDoUpdate({
            target: customersTable.phoneE164,
            set: {
              // A POS cashier's spelling is the least trustworthy name we hold,
              // so it only wins where nothing better exists. (D-24)
              fullName: sql`
                CASE WHEN EXCLUDED.full_name IS NOT NULL
                       AND name_trust_rank(EXCLUDED.name_source)
                           >= name_trust_rank(${customersTable.nameSource})
                     THEN EXCLUDED.full_name
                     ELSE ${customersTable.fullName} END`,
              nameSource: sql`
                CASE WHEN EXCLUDED.full_name IS NOT NULL
                       AND name_trust_rank(EXCLUDED.name_source)
                           >= name_trust_rank(${customersTable.nameSource})
                     THEN EXCLUDED.name_source
                     ELSE ${customersTable.nameSource} END`,
              firstSeenAt: sql`LEAST(${customersTable.firstSeenAt}, EXCLUDED.first_seen_at)`,
              lastSeenAt: sql`GREATEST(${customersTable.lastSeenAt}, EXCLUDED.last_seen_at)`,
              updatedAt: new Date(),
            },
          });
      }

      // Resolve every phone in this file to a customer id.
      const phoneList = [...byPhone.keys()];
      const idByPhone = new Map<string, number>();
      for (const part of chunk(phoneList, 1000)) {
        const found = await t
          .select({ id: customersTable.id, phone: customersTable.phoneE164 })
          .from(customersTable)
          .where(inArray(customersTable.phoneE164, part));
        for (const row of found) idByPhone.set(row.phone, row.id);
      }

      // ── Sales ──────────────────────────────────────────────────────────────
      const saleValues = rows.map((row: ParsedSale) => ({
        voucherNo: row.voucherNo,
        batchId,
        storeId: storeIdByPrefix.get(row.voucherPrefix)!,
        billedAt: row.billedAt,
        customerId: row.phoneE164 ? (idByPhone.get(row.phoneE164) ?? null) : null,
        customerNameRaw: row.customerNameRaw,
        phoneRaw: row.phoneRaw,
        qty: row.qty,
        billAmount: String(row.billAmount),
        taxableAmount: row.taxableAmount === null ? null : String(row.taxableAmount),
        itemDiscAmount: row.itemDiscAmount === null ? null : String(row.itemDiscAmount),
        salesmanCode: row.salesmanCode,
        helperName: row.helperName,
        payments: row.payments,
        remarks: row.remarks,
        raw: row.raw,
      }));

      // Dedupe within the file so ON CONFLICT sees each voucher once.
      const uniqueSales = [...new Map(saleValues.map((s) => [s.voucherNo, s])).values()];

      let salesInserted = 0;
      for (const part of chunk(uniqueSales)) {
        const inserted = await t
          .insert(salesTable)
          .values(part)
          .onConflictDoNothing({ target: salesTable.voucherNo })
          .returning({ id: salesTable.id });
        salesInserted += inserted.length;
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

      // Recompute lifecycle for every customer, from scratch. Order-independent
      // by design: importing sales before leads must not permanently mark the
      // whole file 'existing'. (D-38)
      await t.execute(sql`SELECT recompute_customer_lifecycle()`);

      return {
        batchId,
        customersInserted: customerValues.length,
        salesInserted,
        salesSkipped: uniqueSales.length - salesInserted,
        rejectedStored: rejected.length,
      };
    });
  } finally {
    await pool.end();
  }

  // Outside the transaction: CONCURRENTLY is illegal inside one. (D-61)
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution`);

  return result;
}

/** Remove a committed batch and everything it wrote. (D-63) */
export async function rollbackBatch(batchId: string): Promise<void> {
  const { db: tx, pool } = txDb();
  try {
    await tx.transaction(async (t) => {
      await t.delete(salesTable).where(eq(salesTable.batchId, batchId));
      await t.delete(importRowsRejected).where(eq(importRowsRejected.batchId, batchId));
      await t
        .update(importBatches)
        .set({ status: 'rolled_back' })
        .where(eq(importBatches.id, batchId));
      await t.execute(sql`SELECT recompute_customer_lifecycle()`);
    });
  } finally {
    await pool.end();
  }
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution`);
}
