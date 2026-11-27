import { timingSafeEqual } from 'node:crypto';
import type { Employee } from '@/lib/hr/employees';

/*
 * One employee's own details for Hemparshwa OS → Settings → Profile, fetched when they open the page (nothing is
 * stored in OS). Personal and job details only: no salary, incentive or notes, and bank account and ID numbers
 * only as their last four digits.
 */

/** Hemparshwa OS calls with its own integration token, which the CRM already holds as HEMPARSHWA_INTEGRATION_TOKEN. */
export function isHemparshwaAuthorized(request: Request): boolean {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!supplied) return false;
  return [process.env.HEMPARSHWA_INTEGRATION_TOKEN, process.env.INTEGRATION_API_TOKEN].some((expected) => {
    if (!expected) return false;
    const a = Buffer.from(expected), b = Buffer.from(supplied);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const last4 = (v: string | null) => {
  const d = (v ?? '').replace(/\s/g, '');
  return d ? `•••• ${d.slice(-4)}` : null;
};

export type MyDetails = {
  employeeCode: string; fullName: string; dateOfBirth: string | null; gender: string | null; maritalStatus: string | null; bloodGroup: string | null;
  contactNo: string | null; email: string | null;
  company: string | null; storeName: string | null; department: string | null; designation: string | null; employeeLevel: string | null; team: string | null;
  joiningDate: string | null; employmentType: string | null; reportingManagerName: string | null; shift: string | null; weeklyOff: string | null;
  status: string; statusSince: string | null;
  emergencyContactName: string | null; emergencyContactRelation: string | null; emergencyContactNo: string | null;
  bankName: string | null; bankAccount: string | null; idProofType: string | null; idProof: string | null;
};

export function myDetails(e: Employee): MyDetails {
  return {
    employeeCode: e.employeeCode, fullName: e.fullName, dateOfBirth: e.dateOfBirth, gender: e.gender, maritalStatus: e.maritalStatus, bloodGroup: e.bloodGroup,
    contactNo: e.contactNo, email: e.email,
    company: e.company, storeName: e.storeName ?? e.storeCode, department: e.department, designation: e.designation, employeeLevel: e.employeeLevel, team: e.team,
    joiningDate: e.joiningDate, employmentType: e.employmentType, reportingManagerName: e.reportingManagerName ?? e.reportingManager, shift: e.shift, weeklyOff: e.weeklyOff,
    status: e.status, statusSince: e.statusSince,
    emergencyContactName: e.emergencyContactName, emergencyContactRelation: e.emergencyContactRelation, emergencyContactNo: e.emergencyContactNo,
    bankName: e.bankName, bankAccount: last4(e.bankAccountNo), idProofType: e.idProofType, idProof: last4(e.idProofNumber),
  };
}
