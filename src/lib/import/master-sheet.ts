/**
 * Master-sheet import — parsing and the commit transaction. (D-84)
 *
 * Extracted from `scripts/import-master-sheet.ts`, which is now a thin CLI
 * wrapper around this module, and consumed identically by the import route
 * handlers under `app/api/import/master-sheet`. One implementation, two
 * front ends — a script and a browser upload duplicating this transaction
 * would be exactly the two-definitions-that-can-disagree bug D-76 exists to
 * prevent, and this is the far riskier place for that to happen: getting the
 * DELETE/INSERT sequence right once and reusing it beats writing it twice and
 * hoping an edit to one side always makes it to the other.
 *
 * Nothing about what this deletes, costs, or cannot know has changed — see
 * the CLI script's header for that. This file is the *how*; that one is
 * still the record of the *why*.
 */

import { createHash } from 'node:crypto';
import { sql, inArray } from 'drizzle-orm';
import { db, txDb } from '@/db';
import {
  campaigns as campaignsTable,
  importBatches,
  importRowsRejected,
  customers as customersTable,
  leadTouches as leadTouchesTable,
} from '@/db/schema';
import { readWorkbook, sheetToRows } from '@/lib/excel';
import { normalizePhone, isForeignNumber, REJECT_CODE } from '@/lib/phone';

const CHUNK = 500;

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sheet → channel. `startedOn` is uniform because the workbook carries no
 * dates; it exists only to satisfy the not-null column and to give the
 * estimated-touch fallback something to point at. (D-29, D-30)
 */
const STARTED_ON = '2026-07-19';

export const SHEETS = [
  {
    sheet: 'Meta',
    channel: 'meta' as const,
    platform: 'instagram',
    campaign: 'Master Sheet — Meta',
    phone: 'Phone_number',
    name: 'Full_name',
    email: 'Email',
  },
  {
    sheet: 'Whatsapp',
    channel: 'whatsapp' as const,
    platform: 'whatsapp_business',
    campaign: 'Master Sheet — WhatsApp',
    phone: 'Phone_number',
    name: null,
    email: null,
  },
  {
    sheet: 'Google Ads',
    channel: 'google' as const,
    platform: 'google_ads',
    campaign: 'Master Sheet — Google Ads',
    phone: 'contact_number',
    name: 'full_name',
    email: 'email',
  },
  {
    sheet: 'Others',
    channel: 'other' as const,
    platform: null,
    campaign: 'Master Sheet — Others',
    phone: 'contact_number',
    name: 'full_name',
    email: 'email',
  },
];

export interface ParsedRow {
  e164: string;
  national: string;
  fullName: string | null;
  email: string | null;
  needsReview: boolean;
  raw: Record<string, unknown>;
}

export interface Rejected {
  rowNumber: number;
  raw: Record<string, unknown>;
  errorCode: string;
  errorMsg: string;
}

export interface SheetResult {
  spec: (typeof SHEETS)[number];
  rows: ParsedRow[];
  rejected: Rejected[];
  rawRows: number;
  duplicates: number;
  flagged: number;
}

function parseSheet(
  workbook: ReturnType<typeof readWorkbook>,
  spec: (typeof SHEETS)[number],
): SheetResult {
  const raw = sheetToRows(workbook, spec.sheet);
  const header = (raw[0] ?? []).map((h) => String(h ?? '').trim());
  const idx = (name: string | null) => (name ? header.indexOf(name) : -1);

  const pi = idx(spec.phone);
  const ni = idx(spec.name);
  const ei = idx(spec.email);
  const ri = header.indexOf('Needs_review');

  if (pi < 0) throw new Error(`Sheet "${spec.sheet}": no column named ${spec.phone}`);

  const byPhone = new Map<string, ParsedRow>();
  const rejected: Rejected[] = [];
  let rawRows = 0;
  let duplicates = 0;
  let flagged = 0;

  raw.slice(1).forEach((row, i) => {
    if (!row.some((v) => v !== null && v !== '')) return;
    const rowNumber = i + 2;
    const cell = row[pi];

    const record: Record<string, unknown> = {};
    header.forEach((h, c) => {
      if (h) record[h] = row[c] ?? null;
    });

    // The WhatsApp sheet carries a stray literal header row in its data.
    if (String(cell ?? '').trim().toLowerCase() === spec.phone.toLowerCase()) {
      rawRows++;
      rejected.push({
        rowNumber,
        raw: record,
        errorCode: 'row.stray_header',
        errorMsg: `Literal "${spec.phone}" in the phone column`,
      });
      return;
    }

    rawRows++;
    const needsReview = String(row[ri] ?? '').trim().toUpperCase() === 'Y';
    if (needsReview) flagged++;

    const phone = normalizePhone(cell);
    if (!phone.ok) {
      rejected.push({
        rowNumber,
        raw: record,
        errorCode: REJECT_CODE[phone.reason],
        errorMsg: `${phone.reason}: ${phone.raw}`,
      });
      return;
    }

    const name = ni >= 0 && row[ni] !== null ? String(row[ni]).trim() || null : null;
    const email = ei >= 0 && row[ei] !== null ? String(row[ei]).trim() || null : null;

    const prev = byPhone.get(phone.e164);
    if (prev) {
      // The workbook's own dedupe compared raw strings, so "+91 98452 32154"
      // and "+919845232154" both survived. Normalizing catches the rest.
      duplicates++;
      prev.fullName ??= name;
      prev.email ??= email;
      prev.needsReview ||= needsReview;
      return;
    }

    byPhone.set(phone.e164, {
      e164: phone.e164,
      national: phone.national,
      fullName: name,
      email,
      needsReview,
      raw: record,
    });
  });

  return { spec, rows: [...byPhone.values()], rejected, rawRows, duplicates, flagged };
}

export interface MasterSheetPreview {
  results: SheetResult[];
  distinctPeople: number;
  fileHash: string;
}

/** Parsing only — no database access, so this is always safe to call. */
export function previewMasterSheet(buffer: Buffer): MasterSheetPreview {
  const workbook = readWorkbook(buffer);
  const results = SHEETS.map((spec) => parseSheet(workbook, spec));
  const distinctPeople = new Set(results.flatMap((r) => r.rows.map((x) => x.e164))).size;
  const fileHash = createHash('sha256').update(buffer).digest('hex');
  return { results, distinctPeople, fileHash };
}

export interface MasterSheetCommitSummary {
  customersUpserted: number;
  touchesInserted: number;
  rejectsStored: number;
}

/**
 * The destructive path (§"What this deletes" on the CLI script). Runs the
 * clear-and-reload as one transaction on the pooled driver — the HTTP driver
 * cannot run multi-statement transactions (D-75) — then refreshes
 * `customer_attribution` once the transaction has committed.
 */
export async function commitMasterSheet(
  buffer: Buffer,
  fileName: string,
  /**
   * Left in `import_batches.uploaded_by` for anyone auditing later. Once auth
   * lands (D-89), the web path should pass the signed-in user's identity here
   * instead of a fixed string.
   */
  uploadedBy: string,
): Promise<MasterSheetCommitSummary> {
  const { results, fileHash } = previewMasterSheet(buffer);

  const { db: tx, pool } = txDb();
  let summary: MasterSheetCommitSummary;

  try {
    summary = await tx.transaction(async (t) => {
      // ── Clear the old lead layer ─────────────────────────────────────────
      // Scoped to source_kind = 'lead' throughout. The two sales batches stay:
      // `sales.batch_id` is NOT NULL and every bill points at one, so deleting
      // them would either fail the constraint or take the revenue with it.
      // `customers` and `sales` are never touched (§O).
      await t.execute(sql`DELETE FROM lead_followups`);
      await t.execute(sql`DELETE FROM lead_touches`);
      await t.execute(sql`DELETE FROM walkin_submissions`);
      await t.execute(sql`
        DELETE FROM import_rows_rejected
        WHERE batch_id IN (SELECT id FROM import_batches WHERE source_kind = 'lead')`);
      await t.execute(sql`DELETE FROM import_batches WHERE source_kind = 'lead'`);
      await t.execute(sql`
        DELETE FROM campaigns
        WHERE id NOT IN (
          SELECT campaign_id FROM import_batches WHERE campaign_id IS NOT NULL)`);

      let customersUpserted = 0;
      let touchesInserted = 0;
      let rejectsStored = 0;

      for (const result of results) {
        const { spec, rows, rejected } = result;

        const [campaign] = await t
          .insert(campaignsTable)
          .values({
            name: spec.campaign,
            channel: spec.channel,
            platform: spec.platform,
            startedOn: STARTED_ON,
            notes: 'Imported from the cleaned master workbook. No per-lead dates in source.',
          })
          .returning({ id: campaignsTable.id });

        const [batch] = await t
          .insert(importBatches)
          .values({
            campaignId: campaign.id,
            sourceType: spec.channel,
            sourceKind: 'lead',
            fileName,
            sheetName: spec.sheet,
            fileHash: `${fileHash}:${spec.sheet}`,
            status: 'committed',
            rowsTotal: result.rawRows,
            rowsOk: rows.length,
            rowsRejected: rejected.length,
            rowsDuplicate: result.duplicates,
            uploadedBy,
            committedAt: new Date(),
          })
          .returning({ id: importBatches.id });

        const touchedAt = new Date(`${STARTED_ON}T00:00:00+05:30`);

        // ── Customers ────────────────────────────────────────────────────
        const values = rows.map((r) => ({
          phoneE164: r.e164,
          phoneNational: r.national,
          isForeign: isForeignNumber(r.e164),
          fullName: r.fullName,
          nameSource: r.fullName ? spec.channel : null,
          email: r.email,
          firstSeenAt: touchedAt,
          lastSeenAt: touchedAt,
        }));

        for (const part of chunk(values)) {
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
          customersUpserted += part.length;
        }

        const idByPhone = new Map<string, number>();
        for (const part of chunk(rows.map((r) => r.e164), 1000)) {
          const found = await t
            .select({ id: customersTable.id, phone: customersTable.phoneE164 })
            .from(customersTable)
            .where(inArray(customersTable.phoneE164, part));
          for (const row of found) idByPhone.set(row.phone, row.id);
        }

        // ── Touches ──────────────────────────────────────────────────────
        const touches = rows.map((r) => ({
          customerId: idByPhone.get(r.e164)!,
          campaignId: campaign.id,
          batchId: batch.id,
          channel: spec.channel,
          touchedAt,
          touchedAtIsEstimated: true, // no dates anywhere in the workbook
          raw: { ...r.raw, needs_review: r.needsReview },
        }));

        for (const part of chunk(touches)) {
          const inserted = await t
            .insert(leadTouchesTable)
            .values(part)
            .onConflictDoNothing()
            .returning({ id: leadTouchesTable.id });
          touchesInserted += inserted.length;
        }

        // ── Rejects ──────────────────────────────────────────────────────
        for (const part of chunk(rejected)) {
          await t.insert(importRowsRejected).values(
            part.map((r) => ({
              batchId: batch.id,
              rowNumber: r.rowNumber,
              raw: r.raw,
              errorCode: r.errorCode,
              errorMsg: r.errorMsg,
            })),
          );
          rejectsStored += part.length;
        }
      }

      await t.execute(sql`SELECT recompute_customer_lifecycle()`);

      return { customersUpserted, touchesInserted, rejectsStored };
    });
  } finally {
    await pool.end();
  }

  await db.execute(sql`REFRESH MATERIALIZED VIEW customer_attribution`);

  return summary;
}
