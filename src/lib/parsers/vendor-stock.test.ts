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
import { parseVendorStockWorkbook, parsePeriodBanner, parsePeriodFromFileName, financialYearStart } from './vendor-stock';

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

describe('parsePeriodFromFileName', () => {
  it('runs a one-date stock report from 1 April of that financial year', () => {
    expect(parsePeriodFromFileName('Stock Report 06-11-2026.xlsx')).toEqual({ periodFrom: '2026-04-01', periodTo: '2026-11-06' });
    expect(parsePeriodFromFileName('Stock Report 10-02-2027.xlsx')).toEqual({ periodFrom: '2026-04-01', periodTo: '2027-02-10' });
  });

  it('reads both ends of a range', () => {
    expect(parsePeriodFromFileName('Stock 01-05-2026 to 06-11-2026.xlsx')).toEqual({ periodFrom: '2026-05-01', periodTo: '2026-11-06' });
  });

  it('returns nulls for a name with no date', () => {
    expect(parsePeriodFromFileName('Party Wise.xlsx')).toEqual({ periodFrom: null, periodTo: null });
    expect(parsePeriodFromFileName(undefined)).toEqual({ periodFrom: null, periodTo: null });
  });

  it('knows where the financial year starts', () => {
    expect(financialYearStart('2026-04-01')).toBe('2026-04-01');
    expect(financialYearStart('2027-03-31')).toBe('2026-04-01');
  });
});

describe('the ERP Stock Report layout (no banner, a row per branch)', () => {
  const header = ['Department', 'Brand', 'Product', 'Item', 'ItemGroup Name', 'Style', 'Design', 'Color', 'Size1', 'Lot No', 'MRP',
    'Branch', 'Account', 'City', 'Voucher', 'Voucher Date', 'Barcode', 'CATEGORY', 'Op. Qty', 'Op. Amt', 'Purc. Qty', 'Purc. Amt',
    'PR Qty', 'PR. Amt', 'Net Purc Qty', 'Net Purc Amt', 'In Qty', 'In Amt', 'Out Qty', 'Out Amt', 'In transit Qty', 'In transit Amt',
    'Sales Qty', 'Sales Amt', 'SR. Qty', 'SR. Amt', 'Net Sales Qty', 'Net Sales Amt', 'CL. Qty', 'CL. Amt', 'CL. MRP'];
  const line = (branch: string, purc: number, inQty: number, out: number, cl: number) => [
    'GARMENT', 'AF', 'SAREES', 'ART - PRINTED', '', 'ART - PRINTED', '052/1', ' ', 'F', '', 2379,
    branch, 'VITTAL COMMERCE LLP', 'SALEM', 'P00715/454', '24/10/2026', '01024967', '', 0, 0, purc, purc * 1100,
    0, 0, purc, purc * 1100, inQty, inQty * 1100, out, out * 1100, 0, 0,
    0, 0, 0, 0, 0, 0, cl, cl * 1100, cl * 2379];

  it('takes the period from the file name and keeps one row per branch', () => {
    const wb = buildWorkbook([header, line('MG', 20, 0, 20, 0), line('JAYANAGAR', 0, 20, 0, 20)]);
    const result = parseVendorStockWorkbook(wb, undefined, 'Stock Report 06-11-2026.xlsx');

    expect(result.periodFrom).toBe('2026-04-01');
    expect(result.periodTo).toBe('2026-11-06');
    expect(result.rows.map((r) => r.branch)).toEqual(['MG', 'JAYANAGAR']);
    const j = result.rows[1];
    expect(j).toMatchObject({
      vendorName: 'VITTAL COMMERCE LLP', itemName: 'ART - PRINTED', department: 'GARMENT', brand: 'AF', product: 'SAREES',
      designNo: '052/1', color: null, size: 'F', city: 'SALEM', mrp: 2379, purchaseVoucher: 'P00715/454',
      purchaseDate: '2026-10-24', inQty: 20, clQty: 20, clMrp: 47580,
    });
    expect(result.summary.uniqueBarcodes).toBe(1);
  });

  it('still refuses a file with neither a banner nor a date in its name', () => {
    const wb = buildWorkbook([header, line('MG', 1, 0, 0, 1)]);
    expect(() => parseVendorStockWorkbook(wb, undefined, 'Stock Report.xlsx')).toThrow(/period/i);
  });

  it('leaves the new columns empty for the older Party Wise layout', () => {
    const wb = buildWorkbook([
      ['From Dated 01/04/2026 To 08/08/2026'],
      ['Account', 'Barcode', 'Item Name', 'CL Qty', 'CL Amt', 'CL MRP'],
      ['V', 'BC1', 'MYSORE SILK', 1, 100, 250],
    ]);
    const [r] = parseVendorStockWorkbook(wb).rows;
    expect(r).toMatchObject({ branch: '', mrp: null, purchaseVoucher: null, purchaseDate: null, itemName: 'MYSORE SILK', clMrp: 250 });
  });

  it('skips fabric rows and counts them', () => {
    const fabric = line('MG', 18, 0, 0, 13.5);
    fabric[0] = 'FABRIC'; fabric[1] = 'DEEPAM'; fabric[2] = 'FABRICS'; fabric[3] = 'FABRICS - SILKS'; fabric[16] = '01024967F';
    const wb = buildWorkbook([header, line('MG', 1, 0, 0, 1), fabric]);
    const result = parseVendorStockWorkbook(wb, undefined, 'Stock Report 06-11-2026.xlsx');
    expect(result.rows).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.summary.fabricRowsSkipped).toBe(1);
  });
});
