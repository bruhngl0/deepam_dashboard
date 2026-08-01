/**
 * Excel reading helpers.
 *
 * The date tests matter more than they look. Excel serials carry no timezone;
 * if the conversion drifts by 5h30m, a bill billed at 02:00 IST lands on the
 * previous day in UTC and can fall outside its attribution window entirely.
 */

import { describe, it, expect } from 'vitest';
import {
  excelSerialToParts,
  parseClockTime,
  toUtcInstant,
  parseTimestamp,
  mapColumns,
  normalizeHeader,
  toNumber,
  toText,
} from './excel';

describe('excel date serials', () => {
  it('converts the first bill date in the sales file', () => {
    // Serial 46222 is 19 July 2026 — the first day of the export window.
    expect(excelSerialToParts(46222)).toEqual({ year: 2026, month: 7, day: 19 });
  });

  it('converts the last bill date in the sales file', () => {
    expect(excelSerialToParts(46229)).toEqual({ year: 2026, month: 7, day: 26 });
  });

  it('handles the Excel 1900 leap-year quirk at the epoch boundary', () => {
    expect(excelSerialToParts(1)).toEqual({ year: 1899, month: 12, day: 31 });
    expect(excelSerialToParts(60)).toEqual({ year: 1900, month: 2, day: 28 });
    expect(excelSerialToParts(61)).toEqual({ year: 1900, month: 3, day: 1 });
  });

  it('is unaffected by the machine timezone', () => {
    // The arithmetic runs entirely in UTC, so the calendar parts are stable
    // regardless of where this test runs.
    const parts = excelSerialToParts(46222);
    expect(parts.day).toBe(19);
  });
});

describe('clock times', () => {
  it('parses the HH:MM:SS strings the POS exports', () => {
    expect(parseClockTime('11:29:36')).toEqual({ hours: 11, minutes: 29, seconds: 36 });
    expect(parseClockTime('12:39:40')).toEqual({ hours: 12, minutes: 39, seconds: 40 });
  });

  it('parses HH:MM without seconds', () => {
    expect(parseClockTime('09:05')).toEqual({ hours: 9, minutes: 5, seconds: 0 });
  });

  it('parses a fraction-of-a-day time', () => {
    expect(parseClockTime(0.5)).toEqual({ hours: 12, minutes: 0, seconds: 0 });
  });

  it('rejects nonsense rather than guessing', () => {
    expect(parseClockTime('not a time')).toBeNull();
    expect(parseClockTime('99:99:99')).toBeNull();
    expect(parseClockTime(null)).toBeNull();
  });
});

describe('combining date + time as IST', () => {
  it('converts the first real bill to the correct UTC instant', () => {
    // BK02-00670, 19 Jul 2026 11:29:36 IST → 05:59:36 UTC
    expect(toUtcInstant(46222, '11:29:36')?.toISOString()).toBe(
      '2026-07-19T05:59:36.000Z',
    );
  });

  it('treats a missing time as midnight IST', () => {
    expect(toUtcInstant(46222, null)?.toISOString()).toBe('2026-07-18T18:30:00.000Z');
  });

  it('keeps a late-evening bill on the correct IST day', () => {
    // 23:45 IST on 26 Jul is 18:15 UTC the same day — it must not roll forward.
    const d = toUtcInstant(46229, '23:45:00')!;
    expect(d.toISOString()).toBe('2026-07-26T18:15:00.000Z');
  });

  it('shifts an early-morning bill back a UTC day, as it should', () => {
    // 02:00 IST on 20 Jul is 20:30 UTC on 19 Jul. Storing the naive local time
    // instead would silently misdate this bill.
    expect(toUtcInstant(46223, '02:00:00')?.toISOString()).toBe(
      '2026-07-19T20:30:00.000Z',
    );
  });

  it('returns null for an unusable serial', () => {
    expect(toUtcInstant(0, '11:00:00')).toBeNull();
    expect(toUtcInstant(NaN, '11:00:00')).toBeNull();
  });
});

describe('walk-in timestamps', () => {
  it('parses the postgres-style timestamp in the onboarding export', () => {
    expect(parseTimestamp('2026-07-19 06:15:58.991219+00')?.toISOString()).toBe(
      '2026-07-19T06:15:58.991Z',
    );
  });

  it('returns null for blanks', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('not a date')).toBeNull();
  });
});

describe('header mapping (D-08)', () => {
  it('matches regardless of case, spaces and underscores', () => {
    const header = ['Preferred Store', 'Full_name', 'Phone_number'];
    const col = mapColumns(header, {
      store: 'preferred_store',
      name: 'full name',
      phone: 'phonenumber',
    });
    expect(col).toEqual({ store: 0, name: 1, phone: 2 });
  });

  it('prefers an exact header match over a substring', () => {
    // "PHONE PAY" must not capture the lookup for "Mobile"/"phone".
    const header = ['Mobile', 'Cash', 'PHONE PAY'];
    const col = mapColumns(header, { phonepe: 'PHONE PAY', mobile: 'Mobile' });
    expect(col.phonepe).toBe(2);
    expect(col.mobile).toBe(0);
  });

  it('reports -1 for a column that is absent', () => {
    const col = mapColumns(['Email'], { phone: 'phone' });
    expect(col.phone).toBe(-1);
  });

  it('handles the differing Meta sheet headers', () => {
    const mainCampaign = ['Preferred Store', 'Email', 'Full_name', 'Phone_number'];
    const privatePreview = ['email', 'full_name', 'phone', 'Date'];
    const spec = { phone: ['phone_number', 'phone'], name: 'full_name' };

    expect(mapColumns(mainCampaign, spec)).toEqual({ phone: 3, name: 2 });
    expect(mapColumns(privatePreview, spec)).toEqual({ phone: 2, name: 1 });
  });

  it('normalizes trailing punctuation in survey-style headers', () => {
    expect(normalizeHeader('which_date_would_you_like_to_visit?')).toBe(
      'whichdatewouldyouliketovisit',
    );
  });
});

describe('scalar coercion', () => {
  it('never returns NaN', () => {
    expect(toNumber('not a number')).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it('reads numbers written with thousands separators', () => {
    expect(toNumber('1,368,946')).toBe(1368946);
  });

  it('trims text and treats blanks as null', () => {
    expect(toText('  coming  ')).toBe('coming');
    expect(toText('   ')).toBeNull();
    expect(toText(null)).toBeNull();
  });
});
