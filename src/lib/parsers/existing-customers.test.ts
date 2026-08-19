/**
 * Existing-customer seed parser.
 *
 * The real export is 61MB / 112k rows and isn't available in this
 * repo/session, so these build a minimal synthetic CSV in memory rather than
 * asserting against real reconciled totals. They exercise the logic real
 * data hits: header detection, the export's own "NOT-CAPTURED"/"INVALID"
 * blank sentinels, date truncation, phone rejection, and the fraud filter.
 */

import { describe, it, expect } from 'vitest';
import { parseExistingCustomersWorkbook } from './existing-customers';

const HEADER = [
  'User__user_id',
  'User__mobile',
  'User__first_name',
  'User__last_name',
  'User__email',
  'User__user_cf_city',
  'User__dob',
  'User__wedding_date',
  'User__registered_store_name',
  'User__Preferred_Store',
  'User__loyalty_type',
  'User__total_bill_count',
  'User__total_bill_amount',
  'User__first_bill_date',
  'User__last_bill_date',
  'User__fraud_status',
];

function row(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    User__user_id: '1033510',
    User__mobile: '919845000591',
    User__first_name: 'Shashi',
    User__last_name: 'Kumar',
    User__email: 'NOT-CAPTURED',
    User__user_cf_city: 'NOT-CAPTURED',
    User__dob: 'NOT-CAPTURED',
    User__wedding_date: 'NOT-CAPTURED',
    User__registered_store_name: 'Deepam Silk MG Road',
    User__Preferred_Store: 'deepamsilks.blr.mg',
    User__loyalty_type: 'loyalty',
    User__total_bill_count: '0',
    User__total_bill_amount: '0',
    User__first_bill_date: '',
    User__last_bill_date: '',
    User__fraud_status: 'NOT_FRAUD',
    ...overrides,
  };
  return HEADER.map((h) => base[h]);
}

function buildCsv(rows: unknown[][]): Buffer {
  const lines = [HEADER.join(','), ...rows.map((r) => r.map((v) => `"${v ?? ''}"`).join(','))];
  return Buffer.from(lines.join('\n'), 'utf-8');
}

describe('parseExistingCustomersWorkbook', () => {
  it('parses a valid row and cleans the export\'s own blank sentinels', () => {
    const csv = buildCsv([row()]);
    const result = parseExistingCustomersWorkbook(csv);

    expect(result.rows).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    const r = result.rows[0];
    expect(r.phoneE164).toBe('+919845000591');
    expect(r.fullName).toBe('Shashi Kumar');
    expect(r.email).toBeNull(); // 'NOT-CAPTURED' cleaned to null
    expect(r.city).toBeNull();
    expect(r.dateOfBirth).toBeNull();
    expect(r.preferredStoreCode).toBe('MG_ROAD');
    expect(r.totalBillCount).toBe(0);
  });

  it('rejects the export\'s own placeholder accounts (junk phone values)', () => {
    const csv = buildCsv([
      row({ User__user_id: '-10001', User__mobile: 'NOT-CAPTURED', User__fraud_status: 'NOT-CAPTURED' }),
      row({ User__user_id: '-10002', User__mobile: 'INVALID', User__fraud_status: 'INVALID' }),
    ]);
    const result = parseExistingCustomersWorkbook(csv);

    expect(result.rows).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((r) => r.errorCode.startsWith('phone.'))).toBe(true);
  });

  it('rejects confirmed-fraud accounts', () => {
    const csv = buildCsv([row({ User__fraud_status: 'CONFIRMED' })]);
    const result = parseExistingCustomersWorkbook(csv);

    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0].errorCode).toBe('fraud.confirmed');
  });

  it('truncates a datetime cell to a plain date and rejects zeroed junk dates', () => {
    const csv = buildCsv([
      row({ User__mobile: '919845000591', User__dob: '1971-06-01 00:00:00' }),
      row({ User__mobile: '919886726513', User__dob: '0000-00-00' }),
    ]);
    const result = parseExistingCustomersWorkbook(csv);

    expect(result.rows[0].dateOfBirth).toBe('1971-06-01');
    expect(result.rows[1].dateOfBirth).toBeNull();
  });

  it('rejects a date with an out-of-range month/day rather than passing it to Postgres', () => {
    // Real value measured in the export: month 15 doesn't exist and would
    // otherwise reach the DB as a date literal and fail the whole insert batch.
    const csv = buildCsv([row({ User__mobile: '919845000591', User__dob: '1977-15-15' })]);
    const result = parseExistingCustomersWorkbook(csv);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].dateOfBirth).toBeNull();
  });

  it('counts bill history correctly in the summary', () => {
    const csv = buildCsv([
      row({ User__mobile: '919845000591', User__total_bill_count: '37' }),
      row({ User__mobile: '919886726513', User__total_bill_count: '0' }),
    ]);
    const result = parseExistingCustomersWorkbook(csv);

    expect(result.summary.withBillHistory).toBe(1);
    expect(result.summary.withoutBillHistory).toBe(1);
  });
});
