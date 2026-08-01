/**
 * Lead parsers — Meta lead forms, WhatsApp broadcast reports, walk-in onboarding.
 *
 * All three produce the same `ParsedLead` shape so the commit path (import/leads.ts)
 * does not care where a lead came from. What differs is how much each source
 * knows: walk-ins carry a real timestamp and eight fields, WhatsApp carries a
 * phone number and nothing else.
 */

import { normalizePhone, isForeignNumber } from '../phone';
import {
  readWorkbook,
  sheetToRows,
  mapColumns,
  parseTimestamp,
  toText,
} from '../excel';

export type RemarkStatus =
  | 'coming'
  | 'not_connected'
  | 'not_available'
  | 'busy'
  | 'not_interested'
  | 'wrong_number'
  | 'other'
  | 'pending';

export interface ParsedLead {
  rowNumber: number;
  phoneE164: string;
  phoneNational: string;
  isForeign: boolean;
  fullName: string | null;
  email: string | null;
  area: string | null;
  city: string | null;
  dateOfBirth: string | null;
  anniversary: string | null;
  /** 'MG_ROAD' | 'JAYANAGAR' | null */
  storeCode: string | null;
  touchedAt: Date | null;
  visitDateRaw: string | null;
  visitSlotRaw: string | null;
  followup: {
    call1Made: boolean | null;
    call2Note: string | null;
    finalRemarkRaw: string | null;
    finalRemark: RemarkStatus;
  } | null;
  walkin: {
    submissionId: string;
    howDidYouHear: string | null;
    purposeOfVisit: string | null;
  } | null;
  raw: Record<string, unknown>;
}

export interface LeadRejectedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  errorCode: string;
  errorMsg: string;
}

export interface LeadParseResult {
  sheetName: string;
  rows: ParsedLead[];
  rejected: LeadRejectedRow[];
  summary: {
    dataRows: number;
    valid: number;
    rejected: number;
    duplicatesInFile: number;
    uniquePhones: number;
    rejectsByCode: Record<string, number>;
  };
}

// ── Shared normalizers ───────────────────────────────────────────────────────

/**
 * Map the store labels used across sources to a canonical store code.
 * Meta writes `jayanagar` / `mg_road`; the walk-in form writes `Jayanagar` /
 * `MG Road`. 69 of 820 walk-in rows leave it blank. (D-28)
 */
export function toStoreCode(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const key = text.toLowerCase().replace(/[\s_-]/g, '');
  if (key.includes('jayanagar')) return 'JAYANAGAR';
  if (key.includes('mgroad') || key === 'mg') return 'MG_ROAD';
  return null;
}

/**
 * Normalize the free-text tele-calling outcome into an enum, keeping the raw
 * value alongside. Measured values carry trailing spaces and inconsistent
 * casing: 'coming ', 'not connected ', 'not Available ',
 * 'not connected / wp msg sent'. Grouping on the raw text produces a dozen
 * variants of the same status. (D-67)
 */
export function toRemarkStatus(value: unknown): RemarkStatus {
  const text = toText(value);
  if (!text) return 'pending';
  const s = text.toLowerCase();

  // Order matters: 'not interested' must be tested before 'not connected'
  // cannot match it, and 'wrong number' before the generic fallbacks.
  if (s.includes('wrong')) return 'wrong_number';
  if (s.includes('not interested') || s.includes('notinterested')) return 'not_interested';
  if (s.includes('not connected') || s.includes('notconnected')) return 'not_connected';
  if (s.includes('not available') || s.includes('notavailable')) return 'not_available';
  if (s.includes('busy')) return 'busy';
  if (s.includes('coming')) return 'coming';
  return 'other';
}

/** 'Yes' / 'No' / blank → boolean | null. */
export function toYesNo(value: unknown): boolean | null {
  const text = toText(value);
  if (!text) return null;
  const s = text.toLowerCase();
  if (s.startsWith('y')) return true;
  if (s.startsWith('n')) return false;
  return null;
}

/** A date-only string (YYYY-MM-DD) for DOB/anniversary columns, or null. */
function toDateOnly(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function blankRow(row: unknown[]): boolean {
  return !row || row.every((v) => v === null || v === '');
}

function captureRaw(header: unknown[], row: unknown[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  header.forEach((h, i) => {
    const key = toText(h);
    if (key) raw[key] = row[i] ?? null;
  });
  return raw;
}

/** Tally rejects and dedupe, shared by all three parsers. */
function summarize(
  rows: ParsedLead[],
  rejected: LeadRejectedRow[],
  dataRows: number,
): LeadParseResult['summary'] {
  const seen = new Set<string>();
  let duplicatesInFile = 0;
  for (const r of rows) {
    if (seen.has(r.phoneE164)) duplicatesInFile++;
    seen.add(r.phoneE164);
  }
  const rejectsByCode: Record<string, number> = {};
  for (const r of rejected) {
    rejectsByCode[r.errorCode] = (rejectsByCode[r.errorCode] ?? 0) + 1;
  }
  return {
    dataRows,
    valid: rows.length,
    rejected: rejected.length,
    duplicatesInFile,
    uniquePhones: seen.size,
    rejectsByCode,
  };
}

// ── Meta lead forms ──────────────────────────────────────────────────────────

/**
 * Parse one sheet of the Meta lead workbook.
 *
 * The five sheets have different, differently-cased, differently-ordered
 * columns — `Main Campaign` uses `Phone_number`, `Private Preview` uses
 * `phone`, three have a visit-date column and two do not. Every column is
 * resolved by header name, never by position. (D-08)
 *
 * No sheet carries a contact timestamp, so `touchedAt` is left null here and
 * the importer substitutes `campaign.started_on`. (D-30)
 */
export function parseMetaSheet(data: Buffer, sheetName: string): LeadParseResult {
  const workbook = readWorkbook(data);
  const rows = sheetToRows(workbook, sheetName);
  if (rows.length === 0) {
    return {
      sheetName,
      rows: [],
      rejected: [],
      summary: summarize([], [], 0),
    };
  }

  const header = rows[0];
  const col = mapColumns(header, {
    phone: ['phone_number', 'phone'],
    fullName: ['full_name', 'fullname'],
    email: 'email',
    store: ['preferred_store', 'preferredstore'],
    visitDate: 'which_date_would_you_like_to_visit',
    visitSlot: 'which_time_works_best_for_you',
    call1: 'call 1 made',
    call2: 'call 2',
    finalRemark: 'final remark',
  });

  if (col.phone < 0) {
    throw new Error(`Sheet "${sheetName}" has no phone column.`);
  }

  const parsed: ParsedLead[] = [];
  const rejected: LeadRejectedRow[] = [];
  let dataRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (blankRow(row)) continue;
    dataRows++;

    const rowNumber = i + 1;
    const raw = captureRaw(header, row);
    const phoneRaw = row[col.phone];
    const phone = normalizePhone(phoneRaw);

    if (!phone.ok) {
      // A lead with no usable phone cannot be joined to anything, so it is
      // quarantined rather than stored as an unreachable customer. (D-25)
      rejected.push({
        rowNumber,
        raw,
        errorCode: `phone.${phone.reason}`,
        errorMsg: `Unusable phone: ${JSON.stringify(phone.raw)}`,
      });
      continue;
    }

    const hasFollowup = col.call1 >= 0 || col.call2 >= 0 || col.finalRemark >= 0;

    parsed.push({
      rowNumber,
      phoneE164: phone.e164,
      phoneNational: phone.national,
      isForeign: false,
      fullName: col.fullName >= 0 ? toText(row[col.fullName]) : null,
      email: col.email >= 0 ? toText(row[col.email]) : null,
      area: null,
      city: null,
      dateOfBirth: null,
      anniversary: null,
      storeCode: col.store >= 0 ? toStoreCode(row[col.store]) : null,
      touchedAt: null, // filled from campaign.started_on (D-30)
      visitDateRaw: col.visitDate >= 0 ? toText(row[col.visitDate]) : null,
      visitSlotRaw: col.visitSlot >= 0 ? toText(row[col.visitSlot]) : null,
      followup: hasFollowup
        ? {
            call1Made: col.call1 >= 0 ? toYesNo(row[col.call1]) : null,
            call2Note: col.call2 >= 0 ? toText(row[col.call2]) : null,
            finalRemarkRaw: col.finalRemark >= 0 ? toText(row[col.finalRemark]) : null,
            finalRemark:
              col.finalRemark >= 0 ? toRemarkStatus(row[col.finalRemark]) : 'pending',
          }
        : null,
      walkin: null,
      raw,
    });
  }

  return { sheetName, rows: parsed, rejected, summary: summarize(parsed, rejected, dataRows) };
}

/** Every sheet name in a Meta workbook, in file order. */
export function listSheets(data: Buffer): string[] {
  return readWorkbook(data).SheetNames;
}

// ── WhatsApp broadcast report ────────────────────────────────────────────────

/**
 * Parse the WhatsApp delivery report.
 *
 * Column A is a phone number, column B a constant label; there is no header
 * row and no timestamp. 6,962 rows carrying 3,696 distinct numbers — 47% of the
 * file is duplicates, which is reported rather than silently collapsed. (D-09, D-55)
 */
export function parseWhatsappSheet(data: Buffer, sheetName = 'Sheet1'): LeadParseResult {
  const workbook = readWorkbook(data);
  const rows = sheetToRows(workbook, sheetName);

  const parsed: ParsedLead[] = [];
  const rejected: LeadRejectedRow[] = [];
  let dataRows = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row[0] === null || row[0] === undefined || row[0] === '') continue;
    dataRows++;

    const rowNumber = i + 1;
    const raw = { phone: row[0] ?? null, label: row[1] ?? null };
    const phone = normalizePhone(row[0]);

    if (!phone.ok) {
      rejected.push({
        rowNumber,
        raw,
        errorCode: `phone.${phone.reason}`,
        errorMsg: `Unusable phone: ${JSON.stringify(phone.raw)}`,
      });
      continue;
    }

    parsed.push({
      rowNumber,
      phoneE164: phone.e164,
      phoneNational: phone.national,
      isForeign: false,
      fullName: null,
      email: null,
      area: null,
      city: null,
      dateOfBirth: null,
      anniversary: null,
      storeCode: null,
      touchedAt: null, // no date in the file at all (D-30)
      visitDateRaw: null,
      visitSlotRaw: null,
      followup: null,
      walkin: null,
      raw,
    });
  }

  return { sheetName, rows: parsed, rejected, summary: summarize(parsed, rejected, dataRows) };
}

// ── Walk-in onboarding form ──────────────────────────────────────────────────

/**
 * Parse the in-store onboarding export.
 *
 * The richest source: real per-row timestamps, store, city, DOB, anniversary,
 * self-reported acquisition source and purpose of visit. 820 submissions from
 * 741 people — the same customer may fill the form twice, and both submissions
 * are kept because both are real events.
 */
export function parseWalkinSheet(data: Buffer, sheetName?: string): LeadParseResult {
  const workbook = readWorkbook(data);
  const sheet = sheetName ?? workbook.SheetNames[0];
  const rows = sheetToRows(workbook, sheet);
  if (rows.length === 0) {
    return { sheetName: sheet, rows: [], rejected: [], summary: summarize([], [], 0) };
  }

  const header = rows[0];
  const col = mapColumns(header, {
    submissionId: 'submission_id',
    phone: ['contact_number', 'contactnumber', 'phone'],
    fullName: ['full_name', 'fullname'],
    email: 'email',
    area: 'area',
    city: 'city',
    dob: 'date_of_birth',
    anniversary: 'anniversary',
    howDidYouHear: 'how_did_you_hear',
    purpose: 'purpose_of_visit',
    createdAt: 'created_at',
    store: 'store',
  });

  if (col.phone < 0 || col.submissionId < 0) {
    throw new Error('Walk-in sheet is missing contact_number or submission_id.');
  }

  const parsed: ParsedLead[] = [];
  const rejected: LeadRejectedRow[] = [];
  let dataRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (blankRow(row)) continue;
    dataRows++;

    const rowNumber = i + 1;
    const raw = captureRaw(header, row);
    const phone = normalizePhone(row[col.phone]);

    if (!phone.ok) {
      rejected.push({
        rowNumber,
        raw,
        errorCode: `phone.${phone.reason}`,
        errorMsg: `Unusable phone: ${JSON.stringify(phone.raw)}`,
      });
      continue;
    }

    const submissionId = toText(row[col.submissionId]);
    if (!submissionId) {
      rejected.push({
        rowNumber,
        raw,
        errorCode: 'submission.missing_id',
        errorMsg: 'Row has no submission_id (needed for idempotent re-import).',
      });
      continue;
    }

    parsed.push({
      rowNumber,
      phoneE164: phone.e164,
      phoneNational: phone.national,
      isForeign: false,
      fullName: col.fullName >= 0 ? toText(row[col.fullName]) : null,
      email: col.email >= 0 ? toText(row[col.email]) : null,
      area: col.area >= 0 ? toText(row[col.area]) : null,
      city: col.city >= 0 ? toText(row[col.city]) : null,
      dateOfBirth: col.dob >= 0 ? toDateOnly(row[col.dob]) : null,
      anniversary: col.anniversary >= 0 ? toDateOnly(row[col.anniversary]) : null,
      storeCode: col.store >= 0 ? toStoreCode(row[col.store]) : null,
      touchedAt: col.createdAt >= 0 ? parseTimestamp(row[col.createdAt]) : null,
      visitDateRaw: null,
      visitSlotRaw: null,
      followup: null,
      walkin: {
        submissionId,
        howDidYouHear: col.howDidYouHear >= 0 ? toText(row[col.howDidYouHear]) : null,
        purposeOfVisit: col.purpose >= 0 ? toText(row[col.purpose]) : null,
      },
      raw,
    });
  }

  return { sheetName: sheet, rows: parsed, rejected, summary: summarize(parsed, rejected, dataRows) };
}

/** Foreign numbers are flagged from the raw value, since normalize rejects them. (D-21) */
export function flagForeign(rejected: LeadRejectedRow[]): number {
  return rejected.filter((r) => r.errorCode === 'phone.foreign').length;
}

export { isForeignNumber };
