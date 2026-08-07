/**
 * Additive Instagram/Meta lead import — shared by `scripts/add-instagram-leads.ts`
 * and `app/api/import/instagram-leads/{preview,commit}`.
 *
 * Unlike `lib/import/master-sheet.ts` (D-84), which deletes and reloads the
 * entire lead layer, this only adds. It parses every sheet of a legacy-format
 * Meta workbook (the original multi-campaign export shape `parseMetaSheet`
 * already handles, D-08) and commits new rows under the *existing*
 * 'Master Sheet — Meta' campaign via `commitLeadImport` — the same commit
 * path the old per-channel importer uses. Customers are upserted
 * (fill-blanks-only, D-24); lead_touches use `ON CONFLICT DO NOTHING` on
 * (customer_id, campaign_id, channel), so a phone number already on file is a
 * no-op and only genuinely new numbers add anything. WhatsApp, Google Ads and
 * Others are never touched.
 */

import { parseMetaSheet, listSheets } from '../parsers/leads';
import { previewLeadImport, commitLeadImport, type LeadPreview } from './leads';

const META_CAMPAIGN = 'Master Sheet — Meta';

/**
 * Sheet names used by the *combined* 4-channel master workbook
 * (`lib/import/master-sheet.ts`'s `SHEETS` spec). Its 'Whatsapp' sheet uses
 * the same `Phone_number` column convention as a Meta sheet, so
 * `parseMetaSheet`'s fuzzy header match would happily "succeed" on it and
 * silently relabel WhatsApp/Google/Others contacts as Instagram leads. This
 * guard exists so that mistake fails loudly instead of quietly.
 */
const COMBINED_WORKBOOK_SHEETS = new Set(['Meta', 'Whatsapp', 'Google Ads', 'Others']);

function assertNotCombinedWorkbook(sheets: string[]) {
  const hit = sheets.find((s) => COMBINED_WORKBOOK_SHEETS.has(s.trim()));
  if (hit) {
    throw new Error(
      `This looks like the combined 4-channel master workbook (sheet "${hit}"), not a ` +
        `per-campaign Instagram export. Use the "Master workbook" uploader above instead — ` +
        `committing it here would misfile WhatsApp/Google/Others contacts as Instagram leads.`,
    );
  }
}

export interface InstagramSheetPreview {
  sheet: string;
  dataRows: number;
  valid: number;
  uniquePhones: number;
  duplicatesInFile: number;
  rejected: number;
  rejectedByCode: { code: string; n: number }[];
  newCustomers: number;
  existingCustomers: number;
  alreadyImported: boolean;
}

export interface InstagramLeadsPreview {
  fileName: string;
  sheets: (InstagramSheetPreview & { _preview: LeadPreview })[];
  distinctPeople: number;
}

/** Phase 1 — parse every sheet, report. Writes nothing. (D-58) */
export async function previewInstagramLeadsImport(
  buffer: Buffer,
  fileName: string,
): Promise<InstagramLeadsPreview> {
  const sheetNames = listSheets(buffer);
  assertNotCombinedWorkbook(sheetNames);

  const sheets: (InstagramSheetPreview & { _preview: LeadPreview })[] = [];
  const allPhones = new Set<string>();

  for (const sheet of sheetNames) {
    const parsed = parseMetaSheet(buffer, sheet);
    if (parsed.summary.dataRows === 0) continue;

    for (const row of parsed.rows) allPhones.add(row.phoneE164);

    const preview = await previewLeadImport(parsed, {
      fileBuffer: buffer,
      fileName,
      channel: 'meta',
      campaignName: META_CAMPAIGN,
    });

    const rejectedByCode = new Map<string, number>();
    for (const r of preview.rejected) {
      rejectedByCode.set(r.errorCode, (rejectedByCode.get(r.errorCode) ?? 0) + 1);
    }

    sheets.push({
      sheet,
      dataRows: preview.summary.dataRows,
      valid: preview.summary.valid,
      uniquePhones: preview.summary.uniquePhones,
      duplicatesInFile: preview.summary.duplicatesInFile,
      rejected: preview.summary.rejected,
      rejectedByCode: [...rejectedByCode.entries()]
        .map(([code, n]) => ({ code, n }))
        .sort((a, b) => b.n - a.n),
      newCustomers: preview.summary.newCustomers,
      existingCustomers: preview.summary.existingCustomers,
      alreadyImported: preview.summary.alreadyImported,
      _preview: preview,
    });
  }

  return { fileName, sheets, distinctPeople: allPhones.size };
}

export interface InstagramLeadsCommitResult {
  sheetsCommitted: number;
  customersUpserted: number;
  touchesInserted: number;
  touchesSkipped: number;
  rejectedStored: number;
}

/** Phase 2 — write every sheet's rows, sequentially. (D-58) */
export async function commitInstagramLeadsImport(
  preview: InstagramLeadsPreview,
  uploadedBy?: string,
): Promise<InstagramLeadsCommitResult> {
  const totals: InstagramLeadsCommitResult = {
    sheetsCommitted: 0,
    customersUpserted: 0,
    touchesInserted: 0,
    touchesSkipped: 0,
    rejectedStored: 0,
  };

  for (const sheet of preview.sheets) {
    const r = await commitLeadImport(sheet._preview, uploadedBy);
    totals.sheetsCommitted += 1;
    totals.customersUpserted += r.customersUpserted;
    totals.touchesInserted += r.touchesInserted;
    totals.touchesSkipped += r.touchesSkipped;
    totals.rejectedStored += r.rejectedStored;
  }

  return totals;
}
