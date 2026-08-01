/**
 * Lead importer — Meta, WhatsApp and walk-in, through one commit path.
 *
 * Same two-phase preview/commit as sales (D-58). What varies between sources is
 * only how much each row knows; the writes are identical.
 */

import { createHash } from 'node:crypto';
import { sql, eq, inArray } from 'drizzle-orm';
import { db, txDb } from '@/db';
import {
  stores as storesTable,
  campaigns as campaignsTable,
  importBatches,
  importRowsRejected,
  customers as customersTable,
  leadTouches as leadTouchesTable,
  leadFollowups as leadFollowupsTable,
  walkinSubmissions as walkinTable,
} from '@/db/schema';
import type { LeadParseResult, ParsedLead } from '../parsers/leads';

const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type LeadChannel = 'meta' | 'whatsapp' | 'walkin';

export interface LeadPreview {
  fileName: string;
  fileHash: string;
  sheetName: string;
  channel: LeadChannel;
  campaign: { id: number; name: string; startedOn: string };
  summary: LeadParseResult['summary'] & {
    /** True when no row in this source carries a real timestamp. (D-30) */
    timestampsEstimated: boolean;
    newCustomers: number;
    existingCustomers: number;
    alreadyImported: boolean;
  };
  rejected: LeadParseResult['rejected'];
  parsed: LeadParseResult;
}

/**
 * Phase 1 — parse, resolve the campaign, report. Writes nothing. (D-58)
 */
export async function previewLeadImport(
  parsed: LeadParseResult,
  opts: {
    fileBuffer: Buffer;
    fileName: string;
    channel: LeadChannel;
    campaignName: string;
  },
): Promise<LeadPreview> {
  const fileHash = createHash('sha256')
    .update(opts.fileBuffer)
    .update(parsed.sheetName) // one workbook can yield five batches (D-07)
    .digest('hex');

  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.name, opts.campaignName))
    .limit(1);

  if (!campaign) {
    throw new Error(
      `Campaign not found: "${opts.campaignName}". Run npm run db:seed, or create it first.`,
    );
  }

  const phones = [...new Set(parsed.rows.map((r) => r.phoneE164))];
  let existingCustomers = 0;
  for (const part of chunk(phones, 1000)) {
    const found = await db
      .select({ phone: customersTable.phoneE164 })
      .from(customersTable)
      .where(inArray(customersTable.phoneE164, part));
    existingCustomers += found.length;
  }

  const priorBatch = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(
      sql`${importBatches.fileHash} = ${fileHash} AND ${importBatches.status} = 'committed'`,
    )
    .limit(1);

  return {
    fileName: opts.fileName,
    fileHash,
    sheetName: parsed.sheetName,
    channel: opts.channel,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      startedOn: String(campaign.startedOn),
    },
    summary: {
      ...parsed.summary,
      timestampsEstimated: parsed.rows.every((r) => r.touchedAt === null),
      newCustomers: phones.length - existingCustomers,
      existingCustomers,
      alreadyImported: priorBatch.length > 0,
    },
    rejected: parsed.rejected,
    parsed,
  };
}

export interface LeadCommitResult {
  batchId: string;
  customersUpserted: number;
  touchesInserted: number;
  touchesSkipped: number;
  followupsInserted: number;
  submissionsInserted: number;
  rejectedStored: number;
}

/**
 * Phase 2 — write. One transaction, then refresh the derived layer outside it
 * because CONCURRENTLY is illegal inside a transaction block. (D-60, D-61)
 */
export async function commitLeadImport(
  preview: LeadPreview,
  uploadedBy?: string,
): Promise<LeadCommitResult> {
  const { rows, rejected } = preview.parsed;
  const { channel, campaign } = preview;

  // Channels with no per-lead date fall back to the campaign start, flagged so
  // the estimate is never mistaken for a real contact time. (D-30)
  const fallbackTouchedAt = new Date(`${campaign.startedOn}T00:00:00+05:30`);

  const { db: tx, pool } = txDb();
  let result: LeadCommitResult;

  try {
    result = await tx.transaction(async (t) => {
      const stores = await t.select().from(storesTable);
      const storeIdByCode = new Map(stores.map((s) => [s.code, s.id]));

      const [batch] = await t
        .insert(importBatches)
        .values({
          campaignId: campaign.id,
          sourceType: channel,
          sourceKind: 'lead',
          fileName: preview.fileName,
          sheetName: preview.sheetName,
          fileHash: preview.fileHash,
          status: 'committed',
          rowsTotal: rows.length + rejected.length,
          rowsOk: rows.length,
          rowsRejected: rejected.length,
          rowsDuplicate: preview.summary.duplicatesInFile,
          uploadedBy: uploadedBy ?? null,
          committedAt: new Date(),
        })
        .returning({ id: importBatches.id });

      const batchId = batch.id;

      // ── Customers ──────────────────────────────────────────────────────────
      // Collapse to one record per phone, keeping the richest values seen. The
      // same person may appear on several rows of one sheet (Main Campaign has
      // 1,009 rows for 984 people) and Postgres rejects an ON CONFLICT DO
      // UPDATE that touches the same row twice in a single statement.
      const byPhone = new Map<string, ParsedLead & { touchedAtResolved: Date }>();

      for (const row of rows) {
        const touchedAtResolved = row.touchedAt ?? fallbackTouchedAt;
        const prev = byPhone.get(row.phoneE164);
        if (!prev) {
          byPhone.set(row.phoneE164, { ...row, touchedAtResolved });
          continue;
        }
        // Earliest touch wins; fill any field the earlier row left blank.
        if (touchedAtResolved < prev.touchedAtResolved) {
          prev.touchedAtResolved = touchedAtResolved;
        }
        prev.fullName ??= row.fullName;
        prev.email ??= row.email;
        prev.area ??= row.area;
        prev.city ??= row.city;
        prev.dateOfBirth ??= row.dateOfBirth;
        prev.anniversary ??= row.anniversary;
        prev.storeCode ??= row.storeCode;
        prev.visitDateRaw ??= row.visitDateRaw;
        prev.visitSlotRaw ??= row.visitSlotRaw;
        prev.followup ??= row.followup;
      }

      const deduped = [...byPhone.values()];

      const customerValues = deduped.map((r) => ({
        phoneE164: r.phoneE164,
        phoneNational: r.phoneNational,
        fullName: r.fullName,
        nameSource: r.fullName ? channel : null,
        email: r.email,
        area: r.area,
        city: r.city,
        dateOfBirth: r.dateOfBirth,
        anniversary: r.anniversary,
        preferredStoreId: r.storeCode ? (storeIdByCode.get(r.storeCode) ?? null) : null,
        firstSeenAt: r.touchedAtResolved,
        lastSeenAt: r.touchedAtResolved,
      }));

      for (const part of chunk(customerValues)) {
        await t
          .insert(customersTable)
          .values(part)
          .onConflictDoUpdate({
            target: customersTable.phoneE164,
            set: {
              // Name follows the trust order; everything else fills blanks only. (D-24)
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
              area: sql`COALESCE(${customersTable.area}, EXCLUDED.area)`,
              city: sql`COALESCE(${customersTable.city}, EXCLUDED.city)`,
              dateOfBirth: sql`COALESCE(${customersTable.dateOfBirth}, EXCLUDED.date_of_birth)`,
              anniversary: sql`COALESCE(${customersTable.anniversary}, EXCLUDED.anniversary)`,
              preferredStoreId: sql`COALESCE(${customersTable.preferredStoreId}, EXCLUDED.preferred_store_id)`,
              firstSeenAt: sql`LEAST(${customersTable.firstSeenAt}, EXCLUDED.first_seen_at)`,
              lastSeenAt: sql`GREATEST(${customersTable.lastSeenAt}, EXCLUDED.last_seen_at)`,
              updatedAt: new Date(),
            },
          });
      }

      const idByPhone = new Map<string, number>();
      for (const part of chunk([...byPhone.keys()], 1000)) {
        const found = await t
          .select({ id: customersTable.id, phone: customersTable.phoneE164 })
          .from(customersTable)
          .where(inArray(customersTable.phoneE164, part));
        for (const row of found) idByPhone.set(row.phone, row.id);
      }

      // ── Lead touches ───────────────────────────────────────────────────────
      const touchValues = deduped.map((r) => ({
        customerId: idByPhone.get(r.phoneE164)!,
        campaignId: campaign.id,
        batchId,
        channel,
        touchedAt: r.touchedAtResolved,
        touchedAtIsEstimated: r.touchedAt === null,
        storePrefId: r.storeCode ? (storeIdByCode.get(r.storeCode) ?? null) : null,
        visitDateRaw: r.visitDateRaw,
        visitSlotRaw: r.visitSlotRaw,
        raw: r.raw,
      }));

      const phoneByCustomerId = new Map<number, string>();
      for (const [phone, id] of idByPhone) phoneByCustomerId.set(id, phone);

      let touchesInserted = 0;
      const touchIdByPhone = new Map<string, number>();
      for (const part of chunk(touchValues)) {
        const inserted = await t
          .insert(leadTouchesTable)
          .values(part)
          // UNIQUE (customer_id, campaign_id, channel) makes re-import a no-op. (D-59)
          .onConflictDoNothing()
          .returning({ id: leadTouchesTable.id, customerId: leadTouchesTable.customerId });
        touchesInserted += inserted.length;
        for (const row of inserted) {
          const phone = phoneByCustomerId.get(row.customerId);
          if (phone) touchIdByPhone.set(phone, row.id);
        }
      }

      // ── Follow-ups (Meta only) ─────────────────────────────────────────────
      const followupValues = deduped
        .filter((r) => r.followup && touchIdByPhone.has(r.phoneE164))
        .map((r) => ({
          leadTouchId: touchIdByPhone.get(r.phoneE164)!,
          call1Made: r.followup!.call1Made,
          call2Note: r.followup!.call2Note,
          finalRemarkRaw: r.followup!.finalRemarkRaw,
          finalRemark: r.followup!.finalRemark,
        }));

      let followupsInserted = 0;
      for (const part of chunk(followupValues)) {
        const inserted = await t
          .insert(leadFollowupsTable)
          .values(part)
          .onConflictDoNothing()
          .returning({ id: leadFollowupsTable.id });
        followupsInserted += inserted.length;
      }

      // ── Walk-in submissions ────────────────────────────────────────────────
      // Every submission is stored, not just one per person: 820 submissions
      // from 741 people, and each is a real visit.
      let submissionsInserted = 0;
      if (channel === 'walkin') {
        const submissionValues = rows
          .filter((r) => r.walkin)
          .map((r) => ({
            submissionId: r.walkin!.submissionId,
            customerId: idByPhone.get(r.phoneE164)!,
            batchId,
            storeId: r.storeCode ? (storeIdByCode.get(r.storeCode) ?? null) : null,
            howDidYouHear: r.walkin!.howDidYouHear,
            purposeOfVisit: r.walkin!.purposeOfVisit,
            area: r.area,
            city: r.city,
            dateOfBirth: r.dateOfBirth,
            anniversary: r.anniversary,
            submittedAt: r.touchedAt ?? fallbackTouchedAt,
            raw: r.raw,
          }));

        const unique = [
          ...new Map(submissionValues.map((s) => [s.submissionId, s])).values(),
        ];

        for (const part of chunk(unique)) {
          const inserted = await t
            .insert(walkinTable)
            .values(part)
            .onConflictDoNothing({ target: walkinTable.submissionId })
            .returning({ id: walkinTable.id });
          submissionsInserted += inserted.length;
        }
      }

      // ── Rejected rows ──────────────────────────────────────────────────────
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

      // Recompute from scratch: this import may flip customers previously
      // classified `existing / no_lead_match` back to `new`. (D-38)
      await t.execute(sql`SELECT recompute_customer_lifecycle()`);

      return {
        batchId,
        customersUpserted: customerValues.length,
        touchesInserted,
        touchesSkipped: touchValues.length - touchesInserted,
        followupsInserted,
        submissionsInserted,
        rejectedStored: rejected.length,
      };
    });
  } finally {
    await pool.end();
  }

  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution`);

  return result;
}
