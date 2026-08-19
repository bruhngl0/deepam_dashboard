/**
 * Vendor stock ledger parser.
 *
 * Source: `Party Wise.xlsx` — one row per barcode per vendor ("Account"), a
 * stock-pcs-and-value snapshot (opening → purchased → sold → closing) for a
 * single reporting period stated once in a banner row above the header, e.g.
 * `From Dated 01/04/2026 To 08/08/2026`. The last row is a totals footer with
 * every quantity/amount column summed and a blank `Barcode` — dropped the
 * same way the sales report's totals row is (D-11).
 */

import { readWorkbook, sheetToRows, mapColumns, toNumber, toText } from '../excel';

export interface ParsedVendorStockRow {
  rowNumber: number;
  vendorName: string;
  barcode: string;
  itemName: string | null;
  itemGroupName: string | null;
  compSize: string | null;
  freshOrDefective: string | null;
  periodFrom: string; // 'YYYY-MM-DD'
  periodTo: string;
  opQty: number | null;
  opAmt: number | null;
  purcQty: number | null;
  purcAmt: number | null;
  prQty: number | null;
  prAmt: number | null;
  netPurcQty: number | null;
  netPurcAmt: number | null;
  inQty: number | null;
  inAmt: number | null;
  outQty: number | null;
  outAmt: number | null;
  inTransitQty: number | null;
  inTransitAmt: number | null;
  salesQty: number | null;
  salesAmt: number | null;
  srQty: number | null;
  srAmt: number | null;
  netSalesQty: number | null;
  netSalesAmt: number | null;
  clQty: number | null;
  clAmt: number | null;
  clMrp: number | null;
  raw: Record<string, unknown>;
}

export interface RejectedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  errorCode: string;
  errorMsg: string;
}

export interface VendorStockParseResult {
  sheetName: string;
  bannerText: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  rows: ParsedVendorStockRow[];
  rejected: RejectedRow[];
  summary: {
    rowsTotal: number;
    purchaseAmount: number;
    netSalesAmount: number;
    closingAmount: number;
    uniqueVendors: number;
    uniqueBarcodes: number;
  };
}

const COLUMN_SPEC = {
  account: ['Account', 'Vendor', 'Party'],
  barcode: 'Barcode',
  itemName: ['Item Name', 'ItemName'],
  itemGroupName: ['Item Group Name', 'Item Group'],
  compSize: ['Comp Size', 'CompSize'],
  freshOrDefective: ['Fresh Or Defective', 'Fresh/Defective', 'FreshDefective'],
  opQty: 'Op Qty',
  opAmt: 'Op Amt',
  purcQty: 'Purc Qty',
  purcAmt: 'Purc Amt',
  prQty: 'PR Qty',
  prAmt: 'PR Amt',
  netPurcQty: 'Net Purc Qty',
  netPurcAmt: 'Net Purc Amt',
  inQty: 'In Qty',
  inAmt: 'In Amt',
  outQty: 'Out Qty',
  outAmt: 'Out Amt',
  inTransitQty: ['In Transit Qty', 'InTransit Qty'],
  inTransitAmt: ['In Transit Amt', 'InTransit Amt'],
  salesQty: 'Sales Qty',
  salesAmt: 'Sales Amt',
  srQty: 'SR Qty',
  srAmt: 'SR Amt',
  netSalesQty: 'Net Sales Qty',
  netSalesAmt: 'Net Sales Amt',
  clQty: 'CL Qty',
  clAmt: 'CL Amt',
  clMrp: ['CL MRP', 'CL Mrp'],
} satisfies Record<string, string | string[]>;

/** Locate the header row by the Account+Barcode column signature. */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const normalized = (rows[i] ?? []).map((c) =>
      String(c ?? '').toLowerCase().replace(/[\s_.]/g, ''),
    );
    if (normalized.includes('account') && normalized.includes('barcode')) return i;
  }
  throw new Error(
    'Could not find the header row — no "Account"+"Barcode" columns in the first 20 rows.',
  );
}

/** `01/04/2026` → `2026-04-01`. */
function toDateOnly(ddmmyyyy: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ddmmyyyy.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Parse the `From Dated 01/04/2026 To 08/08/2026` banner into an ISO period. */
export function parsePeriodBanner(bannerText: string | null): {
  periodFrom: string | null;
  periodTo: string | null;
} {
  if (!bannerText) return { periodFrom: null, periodTo: null };
  const m = /(\d{1,2}\/\d{1,2}\/\d{4})\s*To\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(bannerText);
  if (!m) return { periodFrom: null, periodTo: null };
  return { periodFrom: toDateOnly(m[1]), periodTo: toDateOnly(m[2]) };
}

export function parseVendorStockWorkbook(
  data: Buffer,
  sheetName?: string,
): VendorStockParseResult {
  const workbook = readWorkbook(data);
  const sheet = sheetName ?? workbook.SheetNames[0];
  const rows = sheetToRows(workbook, sheet);

  const headerRow = findHeaderRow(rows);
  const header = rows[headerRow];
  const col = mapColumns(header, COLUMN_SPEC);

  if (col.account < 0 || col.barcode < 0) {
    throw new Error('Vendor stock sheet is missing a required column (Account or Barcode).');
  }

  const bannerText =
    rows
      .slice(0, headerRow)
      .map((r) => toText(r?.[0]))
      .filter((t): t is string => t !== null)
      .join(' | ') || null;

  const { periodFrom, periodTo } = parsePeriodBanner(bannerText);
  if (!periodFrom || !periodTo) {
    throw new Error(
      `Could not parse a "From Dated … To …" period from the banner: ${JSON.stringify(bannerText)}`,
    );
  }

  const parsed: ParsedVendorStockRow[] = [];
  const rejected: RejectedRow[] = [];
  const vendors = new Set<string>();
  const barcodes = new Set<string>();

  let purchaseAmount = 0;
  let netSalesAmount = 0;
  let closingAmount = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1;

    const raw: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      const key = toText(h);
      if (key) raw[key] = row[idx] ?? null;
    });

    const barcode = toText(row[col.barcode]);

    // Blank barcode ⇒ the totals row or a spacer. (D-11, generalized)
    if (!barcode) {
      const hasContent = row.some((v) => v !== null && v !== '');
      if (hasContent) {
        rejected.push({
          rowNumber,
          raw,
          errorCode: 'barcode.missing',
          errorMsg: 'Row has no barcode (totals or spacer row).',
        });
      }
      continue;
    }

    const vendorName = toText(row[col.account]);
    if (!vendorName) {
      rejected.push({
        rowNumber,
        raw,
        errorCode: 'account.missing',
        errorMsg: 'Row has a barcode but no Account (vendor) name.',
      });
      continue;
    }

    vendors.add(vendorName);
    barcodes.add(barcode);

    const purcAmt = toNumber(row[col.purcAmt]);
    const netSalesAmt = toNumber(row[col.netSalesAmt]);
    const clAmt = toNumber(row[col.clAmt]);
    purchaseAmount += purcAmt ?? 0;
    netSalesAmount += netSalesAmt ?? 0;
    closingAmount += clAmt ?? 0;

    parsed.push({
      rowNumber,
      vendorName,
      barcode,
      itemName: toText(row[col.itemName]),
      itemGroupName: toText(row[col.itemGroupName]),
      compSize: toText(row[col.compSize]),
      freshOrDefective: toText(row[col.freshOrDefective]),
      periodFrom,
      periodTo,
      opQty: toNumber(row[col.opQty]),
      opAmt: toNumber(row[col.opAmt]),
      purcQty: toNumber(row[col.purcQty]),
      purcAmt,
      prQty: toNumber(row[col.prQty]),
      prAmt: toNumber(row[col.prAmt]),
      netPurcQty: toNumber(row[col.netPurcQty]),
      netPurcAmt: toNumber(row[col.netPurcAmt]),
      inQty: toNumber(row[col.inQty]),
      inAmt: toNumber(row[col.inAmt]),
      outQty: toNumber(row[col.outQty]),
      outAmt: toNumber(row[col.outAmt]),
      inTransitQty: toNumber(row[col.inTransitQty]),
      inTransitAmt: toNumber(row[col.inTransitAmt]),
      salesQty: toNumber(row[col.salesQty]),
      salesAmt: toNumber(row[col.salesAmt]),
      srQty: toNumber(row[col.srQty]),
      srAmt: toNumber(row[col.srAmt]),
      netSalesQty: toNumber(row[col.netSalesQty]),
      netSalesAmt,
      clQty: toNumber(row[col.clQty]),
      clAmt,
      clMrp: toNumber(row[col.clMrp]),
      raw,
    });
  }

  return {
    sheetName: sheet,
    bannerText,
    periodFrom,
    periodTo,
    rows: parsed,
    rejected,
    summary: {
      rowsTotal: parsed.length,
      purchaseAmount: Math.round(purchaseAmount * 100) / 100,
      netSalesAmount: Math.round(netSalesAmount * 100) / 100,
      closingAmount: Math.round(closingAmount * 100) / 100,
      uniqueVendors: vendors.size,
      uniqueBarcodes: barcodes.size,
    },
  };
}

export const VENDOR_STOCK_REJECT_CODES = {
  barcodeMissing: 'barcode.missing',
  accountMissing: 'account.missing',
} as const;
