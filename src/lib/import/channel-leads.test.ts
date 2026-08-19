import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('@/db', () => ({
  db: {},
  txDb: () => {
    throw new Error('Database access is not expected while parsing a workbook.');
  },
}));

import { parseChannelLeadsWorkbook } from './channel-leads';

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('WhatsApp delivered-numbers import', () => {
  it('accepts the headerless phone-list export without dropping its first row', () => {
    const parsed = parseChannelLeadsWorkbook(
      workbookBuffer([
        [919900512580, 'Whatsapp Campaign - Delivered - Numbers'],
        [919741971773, 'Whatsapp Campaign - Delivered - Numbers'],
        [919880334334, 'Whatsapp Campaign - Delivered - Numbers'],
      ]),
      'whatsapp',
    );

    expect(parsed.rawRows).toBe(3);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows.map((row) => row.e164)).toEqual([
      '+919900512580',
      '+919741971773',
      '+919880334334',
    ]);
    expect(parsed.rows[0]?.rowNumber).toBe(1);
  });

  it('continues to require a named phone column for non-WhatsApp imports', () => {
    expect(() =>
      parseChannelLeadsWorkbook(workbookBuffer([[919900512580]]), 'meta'),
    ).toThrow('No phone column found');
  });
});
