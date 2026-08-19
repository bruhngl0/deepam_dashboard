/**
 * Existing-customer seed parser.
 *
 * Source: a bulk loyalty/CRM export (Capillary-style, e.g.
 * "Complete_Nov__Users__...csv") — one row per person, phone the identity
 * key, no banner rows: the header is row 0. Distinct from every other
 * source this app reads because it is not itself proof from a bill or a
 * lead form — it is the business's own customer registry, imported to seed
 * lifecycle=`existing` for everyone in it before any lead/sales import
 * runs. See the note atop `db/schema.ts`'s `loyaltyCustomers` table for how
 * that classification survives `recompute_customer_lifecycle()`.
 *
 * The export uses the literal strings "NOT-CAPTURED" / "INVALID" /
 * "not-interested" in place of a blank cell, including for its own three
 * placeholder accounts (negative `User__user_id`s -10001..-10003) — those
 * rows fail phone validation and are rejected the same as any other junk
 * number, no special-casing needed.
 */

import { normalizePhone, REJECT_CODE } from '../phone';
import { readWorkbook, sheetToRows, mapColumns, toNumber, toText } from '../excel';
import { toStoreCode } from './leads';

export interface ParsedExistingCustomer {
  rowNumber: number;
  phoneRaw: string | null;
  phoneE164: string;
  phoneNational: string;
  fullName: string | null;
  email: string | null;
  city: string | null;
  dateOfBirth: string | null; // 'YYYY-MM-DD'
  anniversary: string | null;
  preferredStoreCode: string | null; // resolved against `stores`, or null
  externalUserId: string | null;
  loyaltyType: string | null;
  registeredStoreName: string | null;
  preferredStoreRaw: string | null;
  totalBillCount: number | null;
  totalBillAmount: number | null;
  firstBillDate: string | null;
  lastBillDate: string | null;
  raw: Record<string, unknown>;
}

export interface RejectedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  errorCode: string;
  errorMsg: string;
}

export interface ExistingCustomersParseResult {
  sheetName: string;
  rows: ParsedExistingCustomer[];
  rejected: RejectedRow[];
  summary: {
    rowsTotal: number;
    withBillHistory: number;
    withoutBillHistory: number;
    uniquePhones: number;
  };
}

const COLUMN_SPEC = {
  mobile: 'User__mobile',
  firstName: 'User__first_name',
  lastName: 'User__last_name',
  email: 'User__email',
  city: 'User__user_cf_city',
  dob: 'User__dob',
  dobFallback: 'User__user_cf_birthday',
  anniversary: 'User__wedding_date',
  anniversaryFallback: 'User__user_cf_anniversary',
  registeredStore: 'User__registered_store_name',
  preferredStore: 'User__Preferred_Store',
  externalUserId: 'User__user_id',
  loyaltyType: 'User__loyalty_type',
  totalBillCount: 'User__total_bill_count',
  totalBillAmount: 'User__total_bill_amount',
  firstBillDate: 'User__first_bill_date',
  lastBillDate: 'User__last_bill_date',
  fraudStatus: 'User__fraud_status',
};

/** Sentinel "blank" values this export uses instead of an empty cell. */
const SENTINELS = new Set(['not-captured', 'invalid', 'not-interested']);

function cleanText(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  return SENTINELS.has(text.toLowerCase()) ? null : text;
}

/**
 * '1971-06-01 00:00:00' or '1971-06-01' → '1971-06-01'. Rejects '0000-00-00'
 * junk and anything not a real calendar date — measured in the export:
 * '1977-15-15' (month 15) would otherwise reach Postgres as a date literal
 * and fail the whole insert batch it's chunked into.
 */
function toDateOnly(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Roundtrip through Date.UTC to catch a real-looking but nonexistent day
  // (Feb 30, Apr 31, ...) — it normalizes instead of throwing, so compare back.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

/** Locate the header row by the `User__mobile` column — no banner rows in this export. */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const normalized = (rows[i] ?? []).map((c) =>
      String(c ?? '').toLowerCase().replace(/[\s_.]/g, ''),
    );
    if (normalized.includes('usermobile')) return i;
  }
  throw new Error('Could not find the header row — no "User__mobile" column in the first 5 rows.');
}

export function parseExistingCustomersWorkbook(
  data: Buffer,
  sheetName?: string,
): ExistingCustomersParseResult {
  const workbook = readWorkbook(data);
  const sheet = sheetName ?? workbook.SheetNames[0];
  const rows = sheetToRows(workbook, sheet);

  const headerRow = findHeaderRow(rows);
  const header = rows[headerRow];
  const col = mapColumns(header, COLUMN_SPEC);

  if (col.mobile < 0) {
    throw new Error('Existing-customer sheet is missing a required column (User__mobile).');
  }

  const parsed: ParsedExistingCustomer[] = [];
  const rejected: RejectedRow[] = [];
  const phones = new Set<string>();
  let withBillHistory = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1;

    const raw: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      const key = toText(h);
      if (key) raw[key] = row[idx] ?? null;
    });

    const phoneRaw = toText(row[col.mobile]);
    const phone = normalizePhone(phoneRaw);
    if (!phone.ok) {
      rejected.push({
        rowNumber,
        raw,
        errorCode: REJECT_CODE[phone.reason],
        errorMsg: `Phone did not validate: ${JSON.stringify(phone.raw)} (${phone.reason})`,
      });
      continue;
    }

    const fraudStatus = toText(row[col.fraudStatus]);
    if (fraudStatus === 'CONFIRMED') {
      rejected.push({
        rowNumber,
        raw,
        errorCode: 'fraud.confirmed',
        errorMsg: 'Loyalty system flagged this account as confirmed fraud.',
      });
      continue;
    }

    phones.add(phone.e164);

    const firstName = cleanText(row[col.firstName]);
    const lastName = cleanText(row[col.lastName]);
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

    const registeredStoreName = cleanText(row[col.registeredStore]);
    const totalBillCount = toNumber(row[col.totalBillCount]);
    if (totalBillCount !== null && totalBillCount > 0) withBillHistory++;

    parsed.push({
      rowNumber,
      phoneRaw,
      phoneE164: phone.e164,
      phoneNational: phone.national,
      fullName,
      email: cleanText(row[col.email]),
      city: cleanText(row[col.city]),
      dateOfBirth: toDateOnly(row[col.dob]) ?? toDateOnly(row[col.dobFallback]),
      anniversary: toDateOnly(row[col.anniversary]) ?? toDateOnly(row[col.anniversaryFallback]),
      preferredStoreCode: toStoreCode(registeredStoreName),
      externalUserId: cleanText(row[col.externalUserId]),
      loyaltyType: cleanText(row[col.loyaltyType]),
      registeredStoreName,
      preferredStoreRaw: cleanText(row[col.preferredStore]),
      totalBillCount,
      totalBillAmount: toNumber(row[col.totalBillAmount]),
      firstBillDate: toDateOnly(row[col.firstBillDate]),
      lastBillDate: toDateOnly(row[col.lastBillDate]),
      raw,
    });
  }

  return {
    sheetName: sheet,
    rows: parsed,
    rejected,
    summary: {
      rowsTotal: parsed.length,
      withBillHistory,
      withoutBillHistory: parsed.length - withBillHistory,
      uniquePhones: phones.size,
    },
  };
}

export const EXISTING_CUSTOMERS_REJECT_CODES = {
  ...REJECT_CODE,
  fraudConfirmed: 'fraud.confirmed',
} as const;
