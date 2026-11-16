import { describe, expect, it } from 'vitest';
import { autoLinks, nameKey } from './match';

const emp = (employeeCode: string, fullName: string, salespersonKey: string | null = null, salespersonLink: string | null = null) => ({ employeeCode, fullName, salespersonKey, salespersonLink });
const sp = (key: string, name: string) => ({ key, name, storeCode: null });

describe('nameKey', () => {
  it('ignores word order, case and punctuation', () => {
    expect(nameKey('M V RAJU')).toBe(nameKey('raju m.v.'));
    expect(nameKey('  ')).toBe('');
  });
});

describe('autoLinks', () => {
  it('links names with the same words', () => {
    expect(autoLinks([emp('DBYA0026', 'M V RAJU')], [sp('EMP-0003', 'Raju M V')])).toEqual([{ employeeCode: 'DBYA0026', key: 'EMP-0003' }]);
  });
  it('skips a name shared by two employees or two salespeople', () => {
    expect(autoLinks([emp('A1001', 'Suresh'), emp('A1002', 'SURESH')], [sp('EMP-0001', 'Suresh')])).toEqual([]);
    expect(autoLinks([emp('A1001', 'Anitha')], [sp('EMP-0001', 'Anitha'), sp('EMP-0002', 'ANITHA')])).toEqual([]);
  });
  it("leaves HR's choices and taken salespeople alone", () => {
    expect(autoLinks([emp('A1001', 'Padma H', null, 'none')], [sp('EMP-0001', 'Padma H')])).toEqual([]);
    expect(autoLinks([emp('A1001', 'Padma H'), emp('A1002', 'Other', 'EMP-0001', 'manual')], [sp('EMP-0001', 'Padma H')])).toEqual([]);
  });
});
