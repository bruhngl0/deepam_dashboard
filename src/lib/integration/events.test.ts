import { describe, expect, it } from 'vitest';
import { canonicalStoreCode, parseWalktrackEvent, possibleCustomerCode, possibleNationalPhone, walktrackClockTime } from './events';

describe('integration event boundary', () => {
  it('canonicalizes the WalkTrack Jayanagar spelling', () => {
    expect(canonicalStoreCode('JAYNAGAR')).toBe('JAYANAGAR');
    expect(canonicalStoreCode('SHUBH_CONVENTION')).toBe('SHUBH_CONVENTION');
    expect(canonicalStoreCode('BLVD_COLLECTION')).toBe('BLVD_COLLECTION');
    expect(canonicalStoreCode('ONLINE')).toBeNull();
  });

  it('accepts Indian national and E.164 phone references', () => {
    expect(possibleNationalPhone('+91 98765 43210')).toBe('9876543210');
    expect(possibleNationalPhone('123')).toBeNull();
  });

  it('accepts CRM Customer IDs, with or without the prefix', () => {
    expect(possibleCustomerCode(' cus-004217 ')).toBe('CUS-004217');
    expect(possibleCustomerCode('004217')).toBe('CUS-004217');
    expect(possibleCustomerCode('4217')).toBeNull();
    expect(possibleCustomerCode('9876543210')).toBeNull();
  });

  it('rejects malformed events', () => {
    expect(parseWalktrackEvent({ source: 'walktrack' })).toBeNull();
  });
});

describe('walktrackClockTime', () => {
  it('reads a time with no offset as IST', () => {
    expect(walktrackClockTime('2026-10-27T16:08:00')).toBe('2026-10-27T16:08:00+05:30');
    expect(walktrackClockTime('2026-10-27T16:08:00.000')).toBe('2026-10-27T16:08:00.000+05:30');
    expect(new Date(walktrackClockTime('2026-10-27T19:00:00')!).toISOString()).toBe('2026-10-27T13:30:00.000Z');
  });
  it('leaves a time with an offset as it is', () => {
    expect(walktrackClockTime('2026-10-27T10:38:00.000Z')).toBe('2026-10-27T10:38:00.000Z');
    expect(walktrackClockTime('2026-10-27T16:08:00+05:30')).toBe('2026-10-27T16:08:00+05:30');
  });
  it('has no time for an empty value', () => {
    expect(walktrackClockTime(null)).toBeNull();
    expect(walktrackClockTime('')).toBeNull();
  });
});
