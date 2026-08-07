/**
 * Bulk per-channel lead import — one file per channel (Meta, WhatsApp, Google
 * Ads, Others), each additive under a persistent 'Master Sheet — <Channel>'
 * campaign (find-or-create, same naming `master-sheet.ts` (D-84) uses).
 *
 * Unlike `master-sheet.ts` this never deletes anything, and unlike
 * `instagram-leads.ts` it isn't tied to the legacy per-campaign Meta export's
 * exact headers — columns are matched fuzzily via `mapColumns`, so whatever
 * raw phone/name/email column names a given channel's export happens to use
 * are picked up without a hardcoded spec per channel.
 *
 * Dedup is the same mechanism as every other importer in this codebase, not a
 * new rule: `customers.phone_e164` is unique (fill-blanks-only upsert, D-24)
 * and `lead_touches` has a unique index on (customer_id, campaign_id,
 * channel) that the insert hits with `ON CONFLICT DO NOTHING` — so a phone
 * number already on file for that channel adds nothing a second time.
 */

import { createHash } from 'node:crypto';
import { sql, eq, inArray } from 'drizzle-orm';
import { db, txDb } from '@/db';
import {
  campaigns as campaignsTable,
  importBatches,
  importRowsRejected,
  customers as customersTable,
  leadTouches as leadTouchesTable,
} from '@/db/schema';
import { readWorkbook, sheetToRows, mapColumns, toText } from '@/lib/excel';
import { normalizePhone, isForeignNumber, REJECT_CODE } from '@/lib/phone';

const CHUNK = 500;

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type BulkLeadChannel = 'meta' | 'whatsapp' | 'google' | 'other';

export const CHANNEL_SPECS: Record<
  BulkLeadChannel,
  { label: string; campaignName: string; platform: string | null }
> = {
  meta: { label: 'Meta', campaignName: 'Master Sheet — Meta', platform: 'instagram' },
  whatsapp: {
    label: 'WhatsApp',
    campaignName: 'Master Sheet — WhatsApp',
    platform: 'whatsapp_business',
  },
  google: { label: 'Google Ads', campaignName: 'Master Sheet — Google Ads', platform: 'google_ads' },
  other: { label: 'Others', campaignName: 'Master Sheet — Others', platform: null },
};

interface ParsedRow {
  rowNumber: number;
  e164: string;
  national: string;
  fullName: string | null;
  email: string | null;
  raw: Record<string, unknown>;
}

interface Rejected {
  rowNumber: number;
  raw: Record<string, unknown>;
  errorCode: string;
  errorMsg: string;
}

/** Reads the first sheet only — each upload here is one channel, one file. */
function parseFirstSheet(buffer: Buffer): {
  sheetName: string;
  rows: ParsedRow[];
  rejected: Rejected[];
  rawRows: number;
  duplicates: number;
} {
  const workbook = readWorkbook(buffer);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets.');

  const raw = sheetToRows(workbook, sheetName);
  const header = (raw[0] ?? []).map((h) => String(h ?? '').trim());
  const cols = mapColumns(header, {
    phone: ['phone_number', 'contact_number', 'mobile_number', 'whatsapp_number', 'phone', 'mobile'],
    name: ['full_name', 'customer_name', 'name'],
    email: ['email_address', 'email'],
  });

  if (cols.phone < 0) {
    throw new Error(
      `No phone column found in "${sheetName}". Expected something like "Phone_number", ` +
        `"Contact_number" or "Mobile".`,
    );
  }

  const byPhone = new Map<string, ParsedRow>();
  const rejected: Rejected[] = [];
  let rawRows = 0;
  let duplicates = 0;

  raw.slice(1).forEach((row, i) => {
    if (!row.some((v) => v !== null && v !== '')) return;
    const rowNumber = i + 2;

    const record: Record<string, unknown> = {};
    header.forEach((h, c) => {
      if (h) record[h] = row[c] ?? null;
    });

    rawRows++;
    const phone = normalizePhone(row[cols.phone]);
    if (!phone.ok) {
      rejected.push({
        rowNumber,
        raw: record,
        errorCode: REJECT_CODE[phone.reason],
        errorMsg: `${phone.reason}: ${phone.raw}`,
      });
      return;
    }

    const name = cols.name >= 0 ? toText(row[cols.name]) : null;
    const email = cols.email >= 0 ? toText(row[cols.email]) : null;

    const prev = byPhone.get(phone.e164);
    if (prev) {
      duplicates++;
      prev.fullName ??= name;
      prev.email ??= email;
      return;
    }

    byPhone.set(phone.e164, {
      rowNumber,
      e164: phone.e164,
      national: phone.national,
      fullName: name,
      email,
      raw: record,
    });
  });

  return { sheetName, rows: [...byPhone.values()], rejected, rawRows, duplicates };
}

export interface ChannelLeadsPreview {
  channel: BulkLeadChannel;
  fileName: string;
  fileHash: string;
  sheetName: string;
  campaignName: string;
  rawRows: number;
  duplicates: number;
  rejected: Rejected[];
  newCustomers: number;
  existingCustomers: number;
  alreadyImported: boolean;
  rows: ParsedRow[];
}

/** Phase 1 — parse, report. Writes nothing. (D-58) */
export async function previewChannelLeads(
  buffer: Buffer,
  fileName: string,
  channel: BulkLeadChannel,
): Promise<ChannelLeadsPreview> {
  const spec = CHANNEL_SPECS[channel];
  const { sheetName, rows, rejected, rawRows, duplicates } = parseFirstSheet(buffer);
  const fileHash = createHash('sha256').update(buffer).update(channel).digest('hex');

  const phones = rows.map((r) => r.e164);
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
    .where(sql`${importBatches.fileHash} = ${fileHash} AND ${importBatches.status} = 'committed'`)
    .limit(1);

  return {
    channel,
    fileName,
    fileHash,
    sheetName,
    campaignName: spec.campaignName,
    rawRows,
    duplicates,
    rejected,
    newCustomers: phones.length - existingCustomers,
    existingCustomers,
    alreadyImported: priorBatch.length > 0,
    rows,
  };
}

export interface ChannelLeadsCommitResult {
  channel: BulkLeadChannel;
  batchId: string;
  customersUpserted: number;
  touchesInserted: number;
  touchesSkipped: number;
  rejectedStored: number;
}

/**
 * Phase 2 — write. Finds or creates the channel's persistent campaign, then
 * upserts customers and inserts lead touches the same way `leads.ts` does.
 * (D-58, D-24, D-59)
 */
export async function commitChannelLeads(
  preview: ChannelLeadsPreview,
  uploadedBy?: string,
): Promise<ChannelLeadsCommitResult> {
  const spec = CHANNEL_SPECS[preview.channel];
  const { db: tx, pool } = txDb();
  let result: ChannelLeadsCommitResult;

  try {
    result = await tx.transaction(async (t) => {
      let [campaign] = await t
        .select()
        .from(campaignsTable)
        .where(eq(campaignsTable.name, spec.campaignName))
        .limit(1);

      if (!campaign) {
        const today = new Date().toISOString().slice(0, 10);
        [campaign] = await t
          .insert(campaignsTable)
          .values({
            name: spec.campaignName,
            channel: preview.channel,
            platform: spec.platform,
            startedOn: today,
            notes: 'Created by the bulk lead importer.',
          })
          .returning();
      }

      const [batch] = await t
        .insert(importBatches)
        .values({
          campaignId: campaign.id,
          sourceType: preview.channel,
          sourceKind: 'lead',
          fileName: preview.fileName,
          sheetName: preview.sheetName,
          fileHash: preview.fileHash,
          status: 'committed',
          rowsTotal: preview.rawRows,
          rowsOk: preview.rows.length,
          rowsRejected: preview.rejected.length,
          rowsDuplicate: preview.duplicates,
          uploadedBy: uploadedBy ?? null,
          committedAt: new Date(),
        })
        .returning({ id: importBatches.id });

      // No per-row date in these exports; every touch falls back to the
      // campaign's start (its creation date, the first time this channel was
      // ever committed), flagged as estimated. (D-30)
      const touchedAt = new Date(`${campaign.startedOn}T00:00:00+05:30`);

      const customerValues = preview.rows.map((r) => ({
        phoneE164: r.e164,
        phoneNational: r.national,
        isForeign: isForeignNumber(r.e164),
        fullName: r.fullName,
        nameSource: r.fullName ? preview.channel : null,
        email: r.email,
        firstSeenAt: touchedAt,
        lastSeenAt: touchedAt,
      }));

      for (const part of chunk(customerValues)) {
        await t
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
              firstSeenAt: sql`LEAST(${customersTable.firstSeenAt}, EXCLUDED.first_seen_at)`,
              lastSeenAt: sql`GREATEST(${customersTable.lastSeenAt}, EXCLUDED.last_seen_at)`,
              updatedAt: new Date(),
            },
          });
      }

      const idByPhone = new Map<string, number>();
      for (const part of chunk(preview.rows.map((r) => r.e164), 1000)) {
        const found = await t
          .select({ id: customersTable.id, phone: customersTable.phoneE164 })
          .from(customersTable)
          .where(inArray(customersTable.phoneE164, part));
        for (const row of found) idByPhone.set(row.phone, row.id);
      }

      const touchValues = preview.rows.map((r) => ({
        customerId: idByPhone.get(r.e164)!,
        campaignId: campaign.id,
        batchId: batch.id,
        channel: preview.channel,
        touchedAt,
        touchedAtIsEstimated: true,
        raw: r.raw,
      }));

      let touchesInserted = 0;
      for (const part of chunk(touchValues)) {
        const inserted = await t
          .insert(leadTouchesTable)
          .values(part)
          // Same phone already touched under this channel/campaign → no-op. (D-59)
          .onConflictDoNothing()
          .returning({ id: leadTouchesTable.id });
        touchesInserted += inserted.length;
      }

      for (const part of chunk(preview.rejected)) {
        await t.insert(importRowsRejected).values(
          part.map((r) => ({
            batchId: batch.id,
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
        channel: preview.channel,
        batchId: batch.id,
        customersUpserted: customerValues.length,
        touchesInserted,
        touchesSkipped: touchValues.length - touchesInserted,
        rejectedStored: preview.rejected.length,
      };
    });
  } finally {
    await pool.end();
  }

  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution`);

  return result;
}
