import { describe, expect, it } from 'vitest';
import type { Employee } from '@/lib/hr/employees';
import { hrPerson } from './hemparshwa-people';

describe('HR list for Auth Control', () => {
  it('sends the job title and status only, never pay, bank, ID or contact details', () => {
    const e = {
      employeeCode: 'DBYA0150', fullName: 'New Hire', designation: 'Junior Sales Executive', department: 'Sales', storeCode: 'S1', storeName: 'MG Road',
      status: 'Active', exitDate: null, monthlyCtc: 30000, bankAccountNo: '123', idProofNumber: 'X', contactNo: '999', email: 'a@b.c', dateOfBirth: '2000-01-01',
    } as unknown as Employee;
    expect(hrPerson(e)).toEqual({ code: 'DBYA0150', name: 'New Hire', designation: 'Junior Sales Executive', department: 'Sales', store: 'MG Road', status: 'Active', exitDate: null });
  });
});
