import { describe, expect, it } from 'vitest';
import { authenticateSalesperson, getSalesperson, isSalespersonLogin, SALESPEOPLE } from './salespeople';

describe('salespeople', () => {
  it('has unique routes and employee numbers for every salesperson', () => {
    expect(SALESPEOPLE).toHaveLength(23);
    expect(new Set(SALESPEOPLE.map(({ slug }) => slug)).size).toBe(23);
    expect(new Set(SALESPEOPLE.map(({ employeeNumber }) => employeeNumber)).size).toBe(23);
  });

  it('uses the employee number without an email extension and its matching password', () => {
    const salesperson = getSalesperson('mary-josephine')!;
    expect(isSalespersonLogin(salesperson, 'DBYA0013', 'Ananta0013')).toBe(true);
    expect(isSalespersonLogin(salesperson, 'dbya0013', 'Ananta0013')).toBe(true);
    expect(isSalespersonLogin(salesperson, 'DBYA0013@deepam.local', 'Ananta0013')).toBe(false);
    expect(isSalespersonLogin(salesperson, 'DBYA0013', 'password')).toBe(false);
  });

  it('identifies the salesperson from the shared login form', () => {
    expect(authenticateSalesperson('DBYA0021', 'Ananta0021')?.name).toBe('Yasar Arafat');
    expect(authenticateSalesperson('DBYA0021@deepam.local', 'Ananta0021')).toBeUndefined();
    expect(authenticateSalesperson('DBYA0021', 'wrong')).toBeUndefined();
  });

  it('accepts the matching Ananta password for every employee', () => {
    for (const salesperson of SALESPEOPLE) {
      expect(authenticateSalesperson(
        salesperson.employeeNumber,
        `Ananta${salesperson.employeeNumber.slice(-4)}`,
      )).toBe(salesperson);
    }
  });
});
