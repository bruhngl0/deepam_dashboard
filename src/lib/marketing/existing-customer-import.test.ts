import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseExistingCustomerCallWorkbook } from './existing-customer-import';

function workbook(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Customers');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

describe('existing customer exhibition list import', () => {
  it('finds the bannered header, normalizes phones, deduplicates, and rejects invalid rows', () => {
    const parsed = parseExistingCustomerCallWorkbook(workbook([
      ['ANANTA SILK WEAVES PRIVATE LIMITED'], ['MG'], ['Customer Master'],
      ['Branch Name', 'ID', 'Customer Name', 'City Name', 'Mobile1'],
      ['MG', 31, 'Asha', 'Bengaluru', 9845531974],
      ['JAYANAGAR', 32, 'Asha updated', '', '9845531974'],
      ['ONLINE', 33, 'Invalid', '', '1234'],
      ['MG', 34, '', '', '9980145745'],
    ]));
    expect(parsed.sheetName).toBe('Customers');
    expect(parsed.duplicatePhones).toBe(1);
    expect(parsed.contacts).toEqual([{ sourceRow: 6, sourceCustomerId: '32', name: 'Asha updated', phone: '+919845531974', branch: 'JAYANAGAR', city: '' }]);
    expect(parsed.rejected).toEqual([{ sourceRow: 7, reason: 'phone.too_short' }, { sourceRow: 8, reason: 'name.empty' }]);
  });
});
