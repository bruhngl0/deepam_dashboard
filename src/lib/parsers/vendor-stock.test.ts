/**
 * Vendor stock ledger parser.
 *
 * No real "Party Wise.xlsx" sample is available in this repo/session, so
 * these build a minimal synthetic workbook in memory (via the same `xlsx`
 * library the parser reads with) rather than asserting against the real
 * reconciled totals the original design session captured. They exercise the
 * same logic real data would hit — header detection, banner/period parsing,
 * and the blank-barcode totals-row rule — just not the real numbers.
 */

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseVendorStockWorkbook, parsePeriodBanner } from './vendor-stock';

function buildWorkbook(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parsePeriodBanner', () => {
  it('reads a "From Dated … To …" banner', () => {
    expect(parsePeriodBanner('Party Wise Stock Report | From Dated 01/04/2026 To 08/08/2026')).toEqual({
      periodFrom: '2026-04-01',
      periodTo: '2026-08-08',
    });
  });

  it('returns nulls when there is no banner', () => {
    expect(parsePeriodBanner(null)).toEqual({ periodFrom: null, periodTo: null });
  });

  it('returns nulls when the banner has no recognisable date pair', () => {
    expect(parsePeriodBanner('Party Wise Stock Report')).toEqual({
      periodFrom: null,
      periodTo: null,
    });
  });
});

describe('parseVendorStockWorkbook', () => {
  const header = [
    'Account',
    'Barcode',
    'Item Name',
    'Item Group Name',
    'Op Qty',
    'Op Amt',
    'Purc Qty',
    'Purc Amt',
    'Net Sales Qty',
    'Net Sales Amt',
    'CL Qty',
    'CL Amt',
  ];

  function row(vendor: string | null, barcode: string | null, extra: Partial<Record<string, unknown>> = {}) {
    return [
      vendor,
      barcode,
      extra.itemName ?? 'ART - POLYSTERS',
      extra.itemGroupName ?? null,
      extra.opQty ?? 10,
      extra.opAmt ?? 1000,
      extra.purcQty ?? 5,
      extra.purcAmt ?? 500,
      extra.netSalesQty ?? 3,
      extra.netSalesAmt ?? 300,
      extra.clQty ?? 12,
      extra.clAmt ?? 1200,
    ];
  }

  it('parses data rows and rejects the blank-barcode totals row', () => {
    const wb = buildWorkbook([
      ['ANANTA SILK WEAVES PRIVATE LIMITED'],
      ['From Dated 01/04/2026 To 08/08/2026'],
      header,
      row('ARTHA HI FASHION', 'BC001'),
      row('ARTHA HI FASHION', 'BC002'),
      [null, null, null, null, 15, 1500, 8, 800, 4, 400, 19, 1900], // totals row, blank barcode
    ]);

    const result = parseVendorStockWorkbook(wb);

    expect(result.rows).toHaveLength(2);
    // Has content but no barcode ⇒ rejected, not silently dropped (D-11).
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].errorCode).toBe('barcode.missing');
    expect(result.periodFrom).toBe('2026-04-01');
    expect(result.periodTo).toBe('2026-08-08');
    expect(result.rows[0].vendorName).toBe('ARTHA HI FASHION');
    expect(result.rows[0].barcode).toBe('BC001');
    expect(result.summary.purchaseAmount).toBe(1000);
    expect(result.summary.uniqueVendors).toBe(1);
    expect(result.summary.uniqueBarcodes).toBe(2);
  });

  it('rejects a row with a barcode but no vendor name', () => {
    const wb = buildWorkbook([
      ['From Dated 01/04/2026 To 08/08/2026'],
      header,
      row(null, 'BC003'),
    ]);

    const result = parseVendorStockWorkbook(wb);

    expect(result.rows).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].errorCode).toBe('account.missing');
  });

  it('throws when the period banner cannot be parsed', () => {
    const wb = buildWorkbook([['Party Wise Stock Report'], header, row('V', 'BC001')]);
    expect(() => parseVendorStockWorkbook(wb)).toThrow(/period/i);
  });
});
