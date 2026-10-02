import { describe, expect, it } from 'vitest';
import { canonicalStoreCode, parseWalktrackEvent, possibleCustomerCode, possibleNationalPhone } from './events';

describe('integration event boundary', () => {
  it('canonicalizes the WalkTrack Jayanagar spelling', () => {
    expect(canonicalStoreCode('JAYNAGAR')).toBe('JAYANAGAR');
  });

  it('accepts Indian national and E.164 phone references', () => {
    expect(possibleNationalPhone('+91 98765 43210')).toBe('9876543210');
    expect(possibleNationalPhone('123')).toBeNull();
  });

  it('accepts only six-digit CRM Customer IDs', () => {
    expect(possibleCustomerCode(' 004217 ')).toBe('004217');
    expect(possibleCustomerCode('4217')).toBeNull();
    expect(possibleCustomerCode('9876543210')).toBeNull();
  });

  it('rejects malformed events', () => {
    expect(parseWalktrackEvent({ source: 'walktrack' })).toBeNull();
  });
});
