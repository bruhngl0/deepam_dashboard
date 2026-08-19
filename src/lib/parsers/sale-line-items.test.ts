/**
 * Barcode-wise sales register parser.
 *
 * No real "Barcode Wise …xlsx" sample is available in this repo/session (see
 * the note atop `vendor-stock.test.ts`), so these build a minimal synthetic
 * workbook rather than asserting the original design session's reconciled
 * totals. They exercise the same logic real data would hit — header
 * detection, the per-day blank-Voucher-No subtotal rule, and signed qty.
 */

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSaleLineItemsWorkbook, voucherSuffix } from './sale-line-items';

function buildWorkbook(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('voucherSuffix', () => {
  it('strips the store prefix, keeping the numeric suffix', () => {
    expect(voucherSuffix('BK01-00670')).toBe('00670');
    expect(voucherSuffix('BK02-01941')).toBe('01941');
  });

  it('returns the input unchanged when there is no trailing digit group', () => {
    expect(voucherSuffix('NOPREFIX')).toBe('NOPREFIX');
  });
});

describe('parseSaleLineItemsWorkbook', () => {
  const header = [
    'Voucher No',
    'Voucher Date',
    'Barcode',
    'Account Name',
    'Item Name',
    'Qty',
    'Purc Value',
    'Sales Rate',
    'Sales Amt',
  ];

  function row(voucherNo: string | null, extra: Partial<Record<string, unknown>> = {}) {
    return [
      voucherNo,
      extra.voucherDate ?? '19/07/2026',
      'barcode' in extra ? extra.barcode : 'BC001',
      extra.accountName ?? 'Jane Doe',
      extra.itemName ?? 'Silk Saree',
      extra.qty ?? 1,
      extra.purcValue ?? 500,
      extra.salesRate ?? 900,
      extra.salesAmt ?? 900,
    ];
  }

  it('parses data rows and drops the per-day blank-voucher subtotal row', () => {
    const wb = buildWorkbook([
      header,
      row('00670'),
      row('00671', { barcode: 'BC002', qty: -1, salesAmt: -900 }), // a return, kept signed
      [null, null, null, null, null, 0, 0, 0, 1800], // subtotal row, blank voucher
    ]);

    const result = parseSaleLineItemsWorkbook(wb);

    expect(result.rows).toHaveLength(2);
    expect(result.rejected).toHaveLength(1); // subtotal row rejected, same as D-11
    expect(result.rejected[0].errorCode).toBe('voucher.missing');
    expect(result.rows[0].voucherDateRaw).toBe('2026-07-19');
    expect(result.rows[1].qty).toBe(-1);
    expect(result.summary.negativeQtyLines).toBe(1);
    expect(result.summary.netQty).toBe(0);
    expect(result.summary.uniqueVouchers).toBe(2);
    expect(result.summary.uniqueBarcodes).toBe(2);
  });

  it('rejects a row with a voucher but no barcode', () => {
    const wb = buildWorkbook([header, row('00672', { barcode: null })]);
    const result = parseSaleLineItemsWorkbook(wb);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0].errorCode).toBe('barcode.missing');
  });

  it('rejects a row with an unparseable voucher date', () => {
    const wb = buildWorkbook([header, row('00673', { voucherDate: 'not-a-date' })]);
    const result = parseSaleLineItemsWorkbook(wb);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0].errorCode).toBe('date.invalid');
  });
});
