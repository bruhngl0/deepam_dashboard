/**
 * Item-level ("barcode-wise") sales register parser.
 *
 * Source: `Barcode Wise …xlsx` — one row per barcode per bill. Unlike the
 * bill-level sales report, this file has no single totals row: it carries a
 * subtotal row per day (plus one grand total), so **any row with a blank
 * `Voucher No` is a subtotal/spacer row** — the same drop-and-reject-if-
 * non-blank treatment as the bill-level sales report's single totals row
 * (D-11), just repeated N times instead of once.
 *
 * `Voucher No` here is the bare numeric suffix with no `BK01-`/`BK02-`
 * prefix — the import layer resolves it against `sales.voucher_no` by
 * suffix + date, not here. `Qty` is kept signed: negative rows are
 * returns/exchanges and are never rejected for it.
 */

import { readWorkbook, sheetToRows, mapColumns, toNumber, toText } from '../excel';

export interface ParsedSaleLineItem {
  rowNumber: number;
  voucherDateRaw: string; // 'YYYY-MM-DD'
  voucherNoRaw: string;
  barcode: string;
  accountNameRaw: string | null;
  itemName: string | null;
  hsnCode: string | null;
  designNo: string | null;
  colorName: string | null;
  size: string | null;
  qty: number | null;
  purcValue: number | null;
  salesRate: number | null;
  amount: number | null;
  itemDiscAmt: number | null;
  itemAmt: number | null;
  addLessAmt: number | null;
  netAmt: number | null;
  taxableAmt: number | null;
  sgstAmt: number | null;
  cgstAmt: number | null;
  igstAmt: number | null;
  otherAddLessAmt: number | null;
  amtWithTax: number | null;
  salesAmt: number | null;
  raw: Record<string, unknown>;
}

export interface RejectedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  errorCode: string;
  errorMsg: string;
}

export interface SaleLineItemsParseResult {
  sheetName: string;
  bannerText: string | null;
  rows: ParsedSaleLineItem[];
  rejected: RejectedRow[];
  summary: {
    linesTotal: number;
    netQty: number;
    grossSalesAmt: number;
    uniqueVouchers: number;
    uniqueBarcodes: number;
    negativeQtyLines: number;
  };
}

const COLUMN_SPEC = {
  voucherNo: 'Voucher No',
  voucherDate: ['Voucher Date', 'Date'],
  barcode: 'Barcode',
  accountName: ['Account Name', 'Account', 'Party Name', 'Customer Name'],
  itemName: ['Item Name', 'ItemName'],
  hsnCode: ['HSN Code', 'HSN'],
  designNo: ['Design No', 'DesignNo'],
  colorName: ['Color Name', 'Color', 'Colour'],
  size: 'Size',
  qty: 'Qty',
  purcValue: 'Purc Value',
  salesRate: 'Sales Rate',
  amount: 'Amount',
  itemDiscAmt: 'Item Disc Amt',
  itemAmt: 'Item Amt',
  addLessAmt: 'Add Less Amt',
  netAmt: 'Net Amt',
  taxableAmt: 'Taxable Amt',
  sgstAmt: ['SGST Amt', 'SGST'],
  cgstAmt: ['CGST Amt', 'CGST'],
  igstAmt: ['IGST Amt', 'IGST'],
  otherAddLessAmt: ['Other Add Less', 'Other Add Less Amt'],
  amtWithTax: 'Amt With Tax',
  salesAmt: 'Sales Amt',
} satisfies Record<string, string | string[]>;

/** Locate the header row by the Voucher No+Barcode column signature. */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const normalized = (rows[i] ?? []).map((c) =>
      String(c ?? '').toLowerCase().replace(/[\s_.]/g, ''),
    );
    if (normalized.includes('voucherno') && normalized.includes('barcode')) return i;
  }
  throw new Error(
    'Could not find the header row — no "Voucher No"+"Barcode" columns in the first 20 rows.',
  );
}

/** `01/04/2026` (or an Excel date serial) → `2026-04-01`. */
function toDateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
    const d = new Date(EXCEL_EPOCH_UTC + Math.floor(value) * 86_400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
  }

  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value).trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function parseSaleLineItemsWorkbook(
  data: Buffer,
  sheetName?: string,
): SaleLineItemsParseResult {
  const workbook = readWorkbook(data);
  const sheet = sheetName ?? workbook.SheetNames[0];
  const rows = sheetToRows(workbook, sheet);

  const headerRow = findHeaderRow(rows);
  const header = rows[headerRow];
  const col = mapColumns(header, COLUMN_SPEC);

  if (col.voucherNo < 0 || col.barcode < 0) {
    throw new Error(
      'Barcode-wise sales sheet is missing a required column (Voucher No or Barcode).',
    );
  }

  const bannerText =
    rows
      .slice(0, headerRow)
      .map((r) => toText(r?.[0]))
      .filter((t): t is string => t !== null)
      .join(' | ') || null;

  const parsed: ParsedSaleLineItem[] = [];
  const rejected: RejectedRow[] = [];
  const vouchers = new Set<string>();
  const barcodes = new Set<string>();

  let netQty = 0;
  let grossSalesAmt = 0;
  let negativeQtyLines = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1;

    const raw: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      const key = toText(h);
      if (key) raw[key] = row[idx] ?? null;
    });

    const voucherNoRaw = toText(row[col.voucherNo]);

    // Blank Voucher No ⇒ a per-day subtotal row or the grand total. (D-11, generalized)
    if (!voucherNoRaw) {
      const hasContent = row.some((v) => v !== null && v !== '');
      if (hasContent) {
        rejected.push({
          rowNumber,
          raw,
          errorCode: 'voucher.missing',
          errorMsg: 'Row has no Voucher No (subtotal or grand-total row).',
        });
      }
      continue;
    }

    const barcode = toText(row[col.barcode]);
    if (!barcode) {
      rejected.push({
        rowNumber,
        raw,
        errorCode: 'barcode.missing',
        errorMsg: 'Row has a Voucher No but no Barcode.',
      });
      continue;
    }

    const voucherDateRaw = toDateOnly(row[col.voucherDate]);
    if (!voucherDateRaw) {
      rejected.push({
        rowNumber,
        raw,
        errorCode: 'date.invalid',
        errorMsg: `Could not read a voucher date from ${JSON.stringify(row[col.voucherDate])}`,
      });
      continue;
    }

    vouchers.add(voucherNoRaw);
    barcodes.add(barcode);

    const qty = toNumber(row[col.qty]);
    if (qty !== null) {
      netQty += qty;
      if (qty < 0) negativeQtyLines++;
    }
    const salesAmt = toNumber(row[col.salesAmt]);
    grossSalesAmt += salesAmt ?? 0;

    parsed.push({
      rowNumber,
      voucherDateRaw,
      voucherNoRaw,
      barcode,
      accountNameRaw: toText(row[col.accountName]),
      itemName: toText(row[col.itemName]),
      hsnCode: toText(row[col.hsnCode]),
      designNo: toText(row[col.designNo]),
      colorName: toText(row[col.colorName]),
      size: toText(row[col.size]),
      qty,
      purcValue: toNumber(row[col.purcValue]),
      salesRate: toNumber(row[col.salesRate]),
      amount: toNumber(row[col.amount]),
      itemDiscAmt: toNumber(row[col.itemDiscAmt]),
      itemAmt: toNumber(row[col.itemAmt]),
      addLessAmt: toNumber(row[col.addLessAmt]),
      netAmt: toNumber(row[col.netAmt]),
      taxableAmt: toNumber(row[col.taxableAmt]),
      sgstAmt: toNumber(row[col.sgstAmt]),
      cgstAmt: toNumber(row[col.cgstAmt]),
      igstAmt: toNumber(row[col.igstAmt]),
      otherAddLessAmt: toNumber(row[col.otherAddLessAmt]),
      amtWithTax: toNumber(row[col.amtWithTax]),
      salesAmt,
      raw,
    });
  }

  return {
    sheetName: sheet,
    bannerText,
    rows: parsed,
    rejected,
    summary: {
      linesTotal: parsed.length,
      netQty,
      grossSalesAmt: Math.round(grossSalesAmt * 100) / 100,
      uniqueVouchers: vouchers.size,
      uniqueBarcodes: barcodes.size,
      negativeQtyLines,
    },
  };
}

/** The bare numeric suffix of a bill-level `sales.voucher_no`, e.g. 'BK01-00670' → '00670'. */
export function voucherSuffix(voucherNo: string): string {
  const m = /(\d+)$/.exec(voucherNo);
  return m ? m[1] : voucherNo;
}

export const SALE_LINE_ITEMS_REJECT_CODES = {
  voucherMissing: 'voucher.missing',
  barcodeMissing: 'barcode.missing',
  dateInvalid: 'date.invalid',
} as const;
