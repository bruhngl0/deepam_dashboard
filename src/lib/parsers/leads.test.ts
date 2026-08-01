/**
 * Lead parser normalizers.
 *
 * Values here are the real ones measured in the source files — trailing
 * spaces, inconsistent casing and all. That messiness is the reason these
 * functions exist.
 */

import { describe, it, expect } from 'vitest';
import { toStoreCode, toRemarkStatus, toYesNo } from './leads';

describe('store code mapping', () => {
  it('maps the labels Meta writes', () => {
    expect(toStoreCode('jayanagar')).toBe('JAYANAGAR');
    expect(toStoreCode('mg_road')).toBe('MG_ROAD');
  });

  it('maps the labels the walk-in form writes', () => {
    expect(toStoreCode('Jayanagar')).toBe('JAYANAGAR');
    expect(toStoreCode('MG Road')).toBe('MG_ROAD');
  });

  it('returns null for the 69 blank walk-in rows rather than guessing (D-28)', () => {
    expect(toStoreCode('')).toBeNull();
    expect(toStoreCode(null)).toBeNull();
    expect(toStoreCode('   ')).toBeNull();
  });

  it('returns null for an unrecognised store', () => {
    expect(toStoreCode('Indiranagar')).toBeNull();
  });
});

describe('remark normalization (D-67)', () => {
  it('normalizes the real values, trailing spaces and all', () => {
    expect(toRemarkStatus('coming ')).toBe('coming');
    expect(toRemarkStatus('Coming ')).toBe('coming');
    expect(toRemarkStatus('not connected ')).toBe('not_connected');
    expect(toRemarkStatus('Not connected ')).toBe('not_connected');
    expect(toRemarkStatus('not Available ')).toBe('not_available');
    expect(toRemarkStatus('busy')).toBe('busy');
    expect(toRemarkStatus('Not interested ')).toBe('not_interested');
  });

  it('handles the compound remark in the Camp - 4 sheet', () => {
    expect(toRemarkStatus('not connected / wp msg sent')).toBe('not_connected');
  });

  it('does not let "not interested" fall through to "not connected"', () => {
    expect(toRemarkStatus('not interested')).toBe('not_interested');
  });

  it('treats a blank remark as pending, not other', () => {
    expect(toRemarkStatus(null)).toBe('pending');
    expect(toRemarkStatus('')).toBe('pending');
    expect(toRemarkStatus('   ')).toBe('pending');
  });

  it('falls back to other for anything unrecognised', () => {
    expect(toRemarkStatus('Whatsapp Msg. Sent ')).toBe('other');
    expect(toRemarkStatus('call later')).toBe('other');
  });

  it('collapses casing variants onto one status', () => {
    const variants = ['coming ', 'Coming ', 'COMING', ' coming'];
    const statuses = new Set(variants.map(toRemarkStatus));
    expect(statuses.size).toBe(1);
  });
});

describe('yes/no columns', () => {
  it('reads the Call 1 Made column', () => {
    expect(toYesNo('Yes')).toBe(true);
    expect(toYesNo('yes')).toBe(true);
    expect(toYesNo('No')).toBe(false);
  });

  it('returns null for blanks, which are common in these sheets', () => {
    expect(toYesNo('')).toBeNull();
    expect(toYesNo(null)).toBeNull();
  });
});
