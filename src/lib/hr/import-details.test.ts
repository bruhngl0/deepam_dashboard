import { describe, expect, it } from 'vitest';
import { parseDetails, toIsoDate, toMobile } from './import-details';

describe('toIsoDate', () => {
  it('reads Excel serials and the HRMS spellings', () => {
    expect(toIsoDate(22782)).toBe('1962-05-16');
    expect(toIsoDate('16-May-1962')).toBe('1962-05-16');
    expect(toIsoDate('16/05/1962')).toBe('1962-05-16');
    expect(toIsoDate('1962-05-16')).toBe('1962-05-16');
    expect(toIsoDate('31-Feb-1990')).toBeNull();
    expect(toIsoDate('')).toBeNull();
  });
});

describe('toMobile', () => {
  it('keeps 10-digit Indian mobiles only', () => {
    expect(toMobile('+91 98450 12345')).toBe('9845012345');
    expect(toMobile(9845012345)).toBe('9845012345');
    expect(toMobile('12345')).toBeNull();
  });
});

describe('parseDetails', () => {
  it('reads the named columns and never the rest', () => {
    const rows = [
      ['Biometric Id', 'EMP ID', 'Display Name', 'Email', 'Mobile Number', 'Date Of Birth (dd-mmm-yyyy)', 'Aadhaar Number'],
      [10004, 'dbya0001', 'Mohan A', 'X@Y.COM', '9845012345', '16-May-1962', '1234 5678 9012'],
      [10005, 'DBYA0001', 'Again', null, null, null, null],
      [null, 'not an id', null, null, null, null, null],
      [10006, 'DBYA0002', 'Neena D', null, '123', 'someday', null],
    ];
    const { rows: out, issues } = parseDetails(rows);
    expect(out).toEqual([
      { employeeCode: 'DBYA0001', name: 'Mohan A', dateOfBirth: '1962-05-16', contactNo: '9845012345', email: 'x@y.com', biometricId: '10004' },
      { employeeCode: 'DBYA0002', name: 'Neena D', dateOfBirth: null, contactNo: null, email: null, biometricId: '10006' },
    ]);
    expect(JSON.stringify(out)).not.toContain('9012');
    expect(issues).toHaveLength(4);
  });
});
