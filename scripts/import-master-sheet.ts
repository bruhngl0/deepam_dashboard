/**
 * Replace all lead data with the cleaned master workbook. (D-84)
 *
 *   npx tsx scripts/import-master-sheet.ts <file.xlsx>          # preview only
 *   npx tsx scripts/import-master-sheet.ts <file.xlsx> --commit # replace
 *
 * The master sheet supersedes the per-channel exports: one workbook, one sheet
 * per channel, phone numbers already reviewed. It carries four channels —
 * Meta, WhatsApp, Google Ads and Others — and the walk-in channel is gone,
 * its people redistributed across the other four by whoever prepared the file.
 *
 * ── What this deletes ───────────────────────────────────────────────────────
 * Every lead touch, follow-up, walk-in submission, campaign and lead import
 * batch. `customers` and `sales` are never touched: a customer row is the
 * identity key the sales table points at, and nothing should ever delete one
 * (§O). Orphaned customers simply stop appearing in the funnel.
 *
 * ── What that costs ─────────────────────────────────────────────────────────
 * `walkin_submissions.how_did_you_hear` is the only evidence for the
 * `self_declared` lifecycle basis. Dropping it makes 143 customers fall through
 * to `lead_matched`, so people who told us they were already customers are
 * reclassified as new acquisitions. That is a real loss of information, not a
 * cosmetic change — it inflates every conversion figure that uses the D-46
 * denominator. Back the tables up before running with --commit.
 *
 * ── What the sheet cannot tell us ───────────────────────────────────────────
 * It has no dates. Every touch is therefore stamped with the campaign start and
 * flagged `touched_at_is_estimated`, so first touch can never be resolved by
 * time — only by the channel-priority tiebreak in `customer_attribution`.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sql, inArray } from 'drizzle-orm';
import '../src/db/load-env';
import { db, txDb } from '../src/db';
import {
  campaigns as campaignsTable,
  importBatches,
  importRowsRejected,
  customers as customersTable,
  leadTouches as leadTouchesTable,
} from '../src/db/schema';
import { readWorkbook, sheetToRows } from '../src/lib/excel';
import { normalizePhone, isForeignNumber, REJECT_CODE } from '../src/lib/phone';

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

const SHEETS = [
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

interface ParsedRow {
  e164: string;
  national: string;
  fullName: string | null;
  email: string | null;
  needsReview: boolean;
  raw: Record<string, unknown>;
}

interface Rejected {
  rowNumber: number;
  raw: Record<string, unknown>;
  errorCode: string;
  errorMsg: string;
}

interface SheetResult {
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

async function main() {
  const file = process.argv[2];
  const commit = process.argv.includes('--commit');

  if (!file) {
    console.error('\nUsage: npx tsx scripts/import-master-sheet.ts <file.xlsx> [--commit]\n');
    process.exit(1);
  }

  const buffer = readFileSync(file);
  const workbook = readWorkbook(buffer);
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  const results = SHEETS.map((spec) => parseSheet(workbook, spec));

  console.log(`\n  ${file}\n`);
  console.log('  Sheet          Rows   Valid  Distinct   Dupes  Rejected  Flagged');
  for (const r of results) {
    console.log(
      `  ${r.spec.sheet.padEnd(13)}${String(r.rawRows).padStart(5)}` +
        `${String(r.rows.length + r.duplicates).padStart(8)}` +
        `${String(r.rows.length).padStart(10)}` +
        `${String(r.duplicates).padStart(8)}` +
        `${String(r.rejected.length).padStart(10)}` +
        `${String(r.flagged).padStart(9)}`,
    );
  }

  const union = new Set(results.flatMap((r) => r.rows.map((x) => x.e164)));
  console.log(`\n  Distinct people across all sheets: ${union.size}`);

  if (!commit) {
    console.log('\n  Preview only. Re-run with --commit to replace the lead data.\n');
    return;
  }

  const { db: tx, pool } = txDb();
  let summary: Record<string, number> = {};

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
            fileName: file.split('/').pop() ?? file,
            sheetName: spec.sheet,
            fileHash: `${fileHash}:${spec.sheet}`,
            status: 'committed',
            rowsTotal: result.rawRows,
            rowsOk: rows.length,
            rowsRejected: rejected.length,
            rowsDuplicate: result.duplicates,
            uploadedBy: 'import-master-sheet.ts',
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

  console.log('\n  Committed.');
  console.log(`    customers upserted  ${summary.customersUpserted}`);
  console.log(`    touches inserted    ${summary.touchesInserted}`);
  console.log(`    rejects stored      ${summary.rejectsStored}\n`);
}

main().catch((e) => {
  console.error('\nFailed:', e.message, '\n');
  process.exit(1);
});
