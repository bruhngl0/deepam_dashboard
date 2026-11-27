import { describe, expect, it } from 'vitest';
import { myDetails } from './my-details';
import type { Employee } from '@/lib/hr/employees';

const e = {
  employeeCode: 'DBYA0001', fullName: 'Test', dateOfBirth: '1990-01-02', contactNo: '9000000001', email: null, biometricId: '77', company: 'Deepam', storeCode: 'STR-001', storeName: 'MG Road',
  department: 'Retail', designation: 'Sales', joiningDate: '2020-05-01', employmentType: 'Full time', reportingManager: 'DBYA0002', reportingManagerName: 'Boss',
  monthlyCtc: 50000, salaryStructure: { basic: 30000 }, incentiveEligible: true, bankName: 'HDFC', bankAccountHolder: 'Test', bankAccountNo: '50100012345678', bankIfsc: 'HDFC0001',
  idProofType: 'Aadhaar', idProofNumber: '1234 5678 9012', status: 'Active', statusSince: null, exitDate: null, exitReason: null,
  emergencyContactName: null, emergencyContactRelation: null, emergencyContactNo: null, bloodGroup: 'O+', notes: 'private', gender: null, maritalStatus: null,
  employeeLevel: 'L2', team: null, shift: null, weeklyOff: 'Tuesday', salespersonKey: null, salespersonLink: null,
} as unknown as Employee;

describe('myDetails', () => {
  it('leaves out pay and notes, and masks bank and ID numbers', () => {
    const d = myDetails(e) as Record<string, unknown>;
    expect(d.bankAccount).toBe('•••• 5678');
    expect(d.idProof).toBe('•••• 9012');
    for (const k of ['monthlyCtc', 'salaryStructure', 'incentiveEligible', 'notes', 'bankAccountNo', 'idProofNumber', 'bankIfsc', 'biometricId']) expect(d).not.toHaveProperty(k);
    expect(JSON.stringify(d)).not.toContain('50100012345678');
  });
});
