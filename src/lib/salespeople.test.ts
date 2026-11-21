import { describe, expect, it } from 'vitest';
import { getSalesperson, getSalespersonByEmployeeNumber, SALESPEOPLE } from './salespeople';

describe('salespeople', () => {
  it('has unique routes and employee numbers for every salesperson', () => {
    expect(SALESPEOPLE).toHaveLength(44);
    expect(new Set(SALESPEOPLE.map(({ slug }) => slug)).size).toBe(44);
    expect(new Set(SALESPEOPLE.map(({ employeeNumber }) => employeeNumber)).size).toBe(44);
  });

  it('finds a desk by employee number, ignoring case and spaces', () => {
    expect(getSalespersonByEmployeeNumber('DBYA0021')?.name).toBe('Yasar Arafat');
    expect(getSalespersonByEmployeeNumber(' dbya0027 ')?.name).toBe('Sheeja');
    expect(getSalespersonByEmployeeNumber('DBYA0021@deepam.local')).toBeUndefined();
    expect(getSalesperson('mary-josephine')?.employeeNumber).toBe('DBYA0013');
  });
});
