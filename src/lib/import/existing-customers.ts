/**
 * Existing-customer seed importer — two-phase preview then commit. (D-58)
 *
 * Meant to run once, before any lead or sales import, so `recompute_customer_lifecycle()`
 * already has loyalty evidence to weigh the moment those later imports trigger
 * it. Idempotent on `customers.phone_e164` and `loyalty_customers.customer_id`
 * (D-59) — re-importing a corrected export upserts rather than duplicating.
 */

import { createHash } from 'node:crypto';
import { sql, inArray } from 'drizzle-orm';
import { db, txDb } from '@/db';
import {
  stores as storesTable,
  importBatches,
  importRowsRejected,
  customers as customersTable,
  loyaltyCustomers,
} from '@/db/schema';
import {
  parseExistingCustomersWorkbook,
  type ParsedExistingCustomer,
  type ExistingCustomersParseResult,
} from '../parsers/existing-customers';

/** Postgres caps a statement at 65535 parameters; stay well clear. (D-62) */
const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ExistingCustomersPreview {
  fileName: string;
  fileHash: string;
  sheetName: string;
  summary: ExistingCustomersParseResult['summary'] & {
    duplicatePhonesInFile: number;
    alreadyImported: boolean;
  };
  rejected: ExistingCustomersParseResult['rejected'];
  parsed: ExistingCustomersParseResult;
}

/** Phase 1 — parse, report. Writes nothing. (D-58) */
export async function previewExistingCustomersImport(
  fileBuffer: Buffer,
  fileName: string,
  sheetName?: string,
): Promise<ExistingCustomersPreview> {
  const parsed = parseExistingCustomersWorkbook(fileBuffer, sheetName);
  const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

  const seen = new Set<string>();
  let duplicatePhonesInFile = 0;
  for (const row of parsed.rows) {
    if (seen.has(row.phoneE164)) duplicatePhonesInFile++;
    seen.add(row.phoneE164);
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
    summary: {
      ...parsed.summary,
      duplicatePhonesInFile,
      alreadyImported: priorBatch.length > 0,
    },
    rejected: parsed.rejected,
    parsed,
  };
}

export interface ExistingCustomersCommitResult {
  batchId: string;
  customersInserted: number;
  customersUpdated: number;
  loyaltyRowsWritten: number;
  rejectedStored: number;
}

/** Phase 2 — write. One transaction; lifecycle recompute and the MV refresh happen last (D-60, D-61). */
export async function commitExistingCustomersImport(
  preview: ExistingCustomersPreview,
  uploadedBy?: string,
): Promise<ExistingCustomersCommitResult> {
  const { rows, rejected } = preview.parsed;
  const { db: tx, pool } = txDb();

  let result: ExistingCustomersCommitResult;

  try {
    result = await tx.transaction(async (t) => {
      const stores = await t.select().from(storesTable);
      const storeIdByCode = new Map(stores.map((s) => [s.code, s.id]));

      const [batch] = await t
        .insert(importBatches)
        .values({
          sourceType: 'existing',
          sourceKind: 'existing_customer',
          fileName: preview.fileName,
          sheetName: preview.sheetName,
          fileHash: preview.fileHash,
          status: 'committed',
          rowsTotal: rows.length + rejected.length,
          rowsOk: rows.length,
          rowsRejected: rejected.length,
          rowsDuplicate: preview.summary.duplicatePhonesInFile,
          uploadedBy: uploadedBy ?? null,
          committedAt: new Date(),
        })
        .returning({ id: importBatches.id });

      const batchId = batch.id;

      // ── Customers ──────────────────────────────────────────────────────────
      // Dedupe by phone first — Postgres refuses an ON CONFLICT DO UPDATE that
      // touches the same row twice in one statement.
      const byPhone = new Map<string, ParsedExistingCustomer>();
      for (const row of rows) byPhone.set(row.phoneE164, row);
      const uniqueRows = [...byPhone.values()];

      const customerValues = uniqueRows.map((row) => {
        const seenAt = row.firstBillDate ? new Date(`${row.firstBillDate}T00:00:00.000Z`) : new Date();
        const lastAt = row.lastBillDate ? new Date(`${row.lastBillDate}T00:00:00.000Z`) : seenAt;
        return {
          phoneE164: row.phoneE164,
          phoneNational: row.phoneNational,
          fullName: row.fullName,
          nameSource: row.fullName ? 'existing' : null,
          email: row.email,
          city: row.city,
          dateOfBirth: row.dateOfBirth,
          anniversary: row.anniversary,
          preferredStoreId: row.preferredStoreCode ? (storeIdByCode.get(row.preferredStoreCode) ?? null) : null,
          firstSeenAt: seenAt < lastAt ? seenAt : lastAt,
          lastSeenAt: lastAt > seenAt ? lastAt : seenAt,
        };
      });

      let customersInserted = 0;
      let customersUpdated = 0;
      for (const part of chunk(customerValues)) {
        const written = await t
          .insert(customersTable)
          .values(part)
          .onConflictDoUpdate({
            target: customersTable.phoneE164,
            set: {
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
              email: sql`COALESCE(${customersTable.email}, EXCLUDED.email)`,
              city: sql`COALESCE(${customersTable.city}, EXCLUDED.city)`,
              dateOfBirth: sql`COALESCE(${customersTable.dateOfBirth}, EXCLUDED.date_of_birth)`,
              anniversary: sql`COALESCE(${customersTable.anniversary}, EXCLUDED.anniversary)`,
              preferredStoreId: sql`COALESCE(${customersTable.preferredStoreId}, EXCLUDED.preferred_store_id)`,
              firstSeenAt: sql`LEAST(${customersTable.firstSeenAt}, EXCLUDED.first_seen_at)`,
              lastSeenAt: sql`GREATEST(${customersTable.lastSeenAt}, EXCLUDED.last_seen_at)`,
              updatedAt: new Date(),
            },
          })
          // `xmax = 0` is true only for a row this statement actually inserted.
          .returning({ id: customersTable.id, phone: customersTable.phoneE164, wasInsert: sql<boolean>`(xmax = 0)` });
        for (const row of written) {
          if (row.wasInsert) customersInserted++;
          else customersUpdated++;
        }
      }

      const idByPhone = new Map<string, number>();
      const phoneList = [...byPhone.keys()];
      for (const part of chunk(phoneList, 1000)) {
        const found = await t
          .select({ id: customersTable.id, phone: customersTable.phoneE164 })
          .from(customersTable)
          .where(inArray(customersTable.phoneE164, part));
        for (const row of found) idByPhone.set(row.phone, row.id);
      }

      // ── Loyalty evidence ───────────────────────────────────────────────────
      const loyaltyValues = uniqueRows.map((row) => ({
        customerId: idByPhone.get(row.phoneE164)!,
        batchId,
        externalUserId: row.externalUserId,
        loyaltyType: row.loyaltyType,
        registeredStoreName: row.registeredStoreName,
        preferredStoreRaw: row.preferredStoreRaw,
        totalBillCount: row.totalBillCount === null ? null : Math.trunc(row.totalBillCount),
        totalBillAmount: row.totalBillAmount === null ? null : String(row.totalBillAmount),
        firstBillDate: row.firstBillDate,
        lastBillDate: row.lastBillDate,
        raw: row.raw,
      }));

      let loyaltyRowsWritten = 0;
      for (const part of chunk(loyaltyValues)) {
        await t
          .insert(loyaltyCustomers)
          .values(part)
          .onConflictDoUpdate({
            target: loyaltyCustomers.customerId,
            set: {
              batchId: sql`EXCLUDED.batch_id`,
              externalUserId: sql`EXCLUDED.external_user_id`,
              loyaltyType: sql`EXCLUDED.loyalty_type`,
              registeredStoreName: sql`EXCLUDED.registered_store_name`,
              preferredStoreRaw: sql`EXCLUDED.preferred_store_raw`,
              totalBillCount: sql`EXCLUDED.total_bill_count`,
              totalBillAmount: sql`EXCLUDED.total_bill_amount`,
              firstBillDate: sql`EXCLUDED.first_bill_date`,
              lastBillDate: sql`EXCLUDED.last_bill_date`,
              raw: sql`EXCLUDED.raw`,
            },
          });
        loyaltyRowsWritten += part.length;
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

      // Recompute lifecycle for every customer, from scratch — this is the
      // step that turns `loyalty_customers` rows into lifecycle='existing'. (D-38)
      await t.execute(sql`SELECT recompute_customer_lifecycle()`);

      return {
        batchId,
        customersInserted,
        customersUpdated,
        loyaltyRowsWritten,
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
