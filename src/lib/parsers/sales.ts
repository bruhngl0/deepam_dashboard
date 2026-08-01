/**
 * POS sales report parser.
 *
 * Source: `MG, JAYANAGAR_Sales Report.xlsx`, one sheet, 847 bills for
 * 19-26 July 2026 totalling ₹2,01,03,733.
 *
 * Shape of the file (D-11):
 *   row 0   ANANTA SILK WEAVES PRIVATE LIMITED
 *   row 1   MG
 *   row 2   Sales List From Dated 19/07/2026 To 26/07/2026\nBranch : MG, JAYANAGAR
 *   row 3   header
 *   row 4+  bills
 *   last    totals row — blank voucher, Qty 1976, Bill Amt 20103733  ← must be dropped
 *
 * The file contains *both* branches with no branch column; the voucher prefix
 * is the only thing that separates them. (D-26)
 */

import { normalizePhone, isForeignNumber, REJECT_CODE } from '../phone';
import {
  readWorkbook,
  sheetToRows,
  mapColumns,
  toUtcInstant,
  toNumber,
  toText,
} from '../excel';

export interface ParsedSale {
  rowNumber: number;
  voucherNo: string;
  /** 'BK01-' | 'BK02-' — resolved to a store at import time. */
  voucherPrefix: string;
  billedAt: Date;
  customerNameRaw: string | null;
  phoneRaw: string | null;
  /** Null for the 66 bills with no usable phone. Still valid revenue. (D-51) */
  phoneE164: string | null;
  phoneNational: string | null;
  isForeign: boolean;
  qty: number | null;
  billAmount: number;
  taxableAmount: number | null;
  itemDiscAmount: number | null;
  salesmanCode: string | null;
  helperName: string | null;
  payments: Record<string, number>;
  remarks: string | null;
  raw: Record<string, unknown>;
}

export interface RejectedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  errorCode: string;
  errorMsg: string;
}

export interface SalesParseResult {
  sheetName: string;
  /** The `Branch : …` banner, retained for the import preview. */
  bannerText: string | null;
  rows: ParsedSale[];
  rejected: RejectedRow[];
  summary: {
    billsTotal: number;
    grossRevenue: number;
    withPhone: number;
    withoutPhone: number;
    revenueWithoutPhone: number;
    uniquePhones: number;
    byPrefix: Record<string, { bills: number; revenue: number }>;
  };
}

/** Payment columns collapse into one JSONB field rather than eight sparse columns. (D-12) */
const PAYMENT_COLUMNS = {
  cash: 'Cash',
  cheque: 'Chq. Amt',
  card: 'CARD SALES',
  advance: 'AdvanceAmt',
  phonepe: 'PHONE PAY',
  amex: 'AMEX',
  gift: 'Gift Use Amt',
  creditNote: 'CreditNote Use Amt',
} as const;

const COLUMN_SPEC = {
  voucher: 'Voucher Prefix',
  date: 'Date',
  customerName: 'Customer Name',
  mobile: 'Mobile',
  qty: 'Qty',
  billAmount: 'Bill Amt',
  taxableAmount: 'Taxable Amt',
  itemDiscAmount: 'Item Disc Amt',
  salesman: 'SalesmanName',
  helper: 'HelperName',
  time: 'Time',
  remarks: 'Remarks',
  ...PAYMENT_COLUMNS,
} as const;

/** Locate the header row by looking for the voucher column, not by position. */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const normalized = (rows[i] ?? []).map((c) =>
      String(c ?? '').toLowerCase().replace(/[\s_.]/g, ''),
    );
    if (normalized.includes('voucherprefix')) return i;
  }
  throw new Error(
    'Could not find the header row — no "Voucher Prefix" column in the first 20 rows.',
  );
}

export function parseSalesWorkbook(
  data: Buffer,
  sheetName?: string,
): SalesParseResult {
  const workbook = readWorkbook(data);
  const sheet = sheetName ?? workbook.SheetNames[0];
  const rows = sheetToRows(workbook, sheet);

  const headerRow = findHeaderRow(rows);
  const header = rows[headerRow];
  const col = mapColumns(header, COLUMN_SPEC);

  if (col.voucher < 0 || col.billAmount < 0 || col.date < 0) {
    throw new Error(
      'Sales sheet is missing a required column (Voucher Prefix, Date or Bill Amt).',
    );
  }

  const bannerText =
    rows
      .slice(0, headerRow)
      .map((r) => toText(r?.[0]))
      .filter((t): t is string => t !== null)
      .join(' | ') || null;

  const parsed: ParsedSale[] = [];
  const rejected: RejectedRow[] = [];
  const phones = new Set<string>();
  const byPrefix: Record<string, { bills: number; revenue: number }> = {};

  let grossRevenue = 0;
  let withoutPhone = 0;
  let revenueWithoutPhone = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1; // 1-indexed, as a spreadsheet displays it

    // Capture the whole row for the audit trail and any later re-derivation. (D-14)
    const raw: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      const key = toText(h);
      if (key) raw[key] = row[idx] ?? null;
    });

    const voucherNo = toText(row[col.voucher]);

    // Blank voucher ⇒ the totals row or a spacer. Dropping these is what stops
    // the ₹2,01,03,733 totals line being imported as a phantom bill. (D-11)
    if (!voucherNo) {
      const hasContent = row.some((v) => v !== null && v !== '');
      if (hasContent) {
        rejected.push({
          rowNumber,
          raw,
          errorCode: 'voucher.missing',
          errorMsg: 'Row has no voucher number (totals or spacer row).',
        });
      }
      continue;
    }

    const billAmount = toNumber(row[col.billAmount]);
    if (billAmount === null) {
      rejected.push({
        rowNumber,
        raw,
        errorCode: 'amount.nan',
        errorMsg: `Bill Amt is not a number: ${JSON.stringify(row[col.billAmount])}`,
      });
      continue;
    }

    const dateSerial = toNumber(row[col.date]);
    const billedAt = dateSerial === null ? null : toUtcInstant(dateSerial, row[col.time]);
    if (!billedAt) {
      rejected.push({
        rowNumber,
        raw,
        errorCode: 'date.invalid',
        errorMsg: `Could not read a bill date from ${JSON.stringify(row[col.date])}`,
      });
      continue;
    }

    const phoneRaw = toText(row[col.mobile]);
    const phone = normalizePhone(phoneRaw);

    // A bill with an unusable phone is NOT rejected — the money is real and
    // counts toward gross revenue. It simply cannot be attributed. (D-51)
    if (!phone.ok) {
      withoutPhone++;
      revenueWithoutPhone += billAmount;
    } else {
      phones.add(phone.e164);
    }

    const payments: Record<string, number> = {};
    for (const key of Object.keys(PAYMENT_COLUMNS) as (keyof typeof PAYMENT_COLUMNS)[]) {
      const idx = col[key];
      if (idx < 0) continue;
      const amount = toNumber(row[idx]);
      if (amount !== null && amount !== 0) payments[key] = amount;
    }

    const voucherPrefix = voucherNo.slice(0, 5);
    const agg = (byPrefix[voucherPrefix] ??= { bills: 0, revenue: 0 });
    agg.bills++;
    agg.revenue += billAmount;
    grossRevenue += billAmount;

    parsed.push({
      rowNumber,
      voucherNo,
      voucherPrefix,
      billedAt,
      customerNameRaw: toText(row[col.customerName]),
      phoneRaw,
      phoneE164: phone.ok ? phone.e164 : null,
      phoneNational: phone.ok ? phone.national : null,
      isForeign: !phone.ok && isForeignNumber(phoneRaw),
      qty: col.qty >= 0 ? toNumber(row[col.qty]) : null,
      billAmount,
      taxableAmount: col.taxableAmount >= 0 ? toNumber(row[col.taxableAmount]) : null,
      itemDiscAmount: col.itemDiscAmount >= 0 ? toNumber(row[col.itemDiscAmount]) : null,
      salesmanCode: col.salesman >= 0 ? toText(row[col.salesman]) : null,
      helperName: col.helper >= 0 ? toText(row[col.helper]) : null,
      payments,
      remarks: col.remarks >= 0 ? toText(row[col.remarks]) : null,
      raw,
    });
  }

  return {
    sheetName: sheet,
    bannerText,
    rows: parsed,
    rejected,
    summary: {
      billsTotal: parsed.length,
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      withPhone: parsed.length - withoutPhone,
      withoutPhone,
      revenueWithoutPhone: Math.round(revenueWithoutPhone * 100) / 100,
      uniquePhones: phones.size,
      byPrefix,
    },
  };
}

/** Rejected-row error codes this parser can emit, for the review panel. (D-54) */
export const SALES_REJECT_CODES = {
  ...REJECT_CODE,
  voucherMissing: 'voucher.missing',
  amountNaN: 'amount.nan',
  dateInvalid: 'date.invalid',
} as const;
