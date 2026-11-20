/** Reads and checks the employee form (/hr/employees/[code]/edit and /hr/employees/new). */

import { BLOOD_GROUPS, EMPLOYEE_CODE, EMPLOYMENT_TYPES, GENDERS, LEVELS, MARITAL_STATUSES, SALARY_PARTS, STATUSES, WEEKDAYS, type EmployeeInput } from './employees';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class FormError extends Error {}

export function text(form: FormData, key: string, max = 200): string | null {
  const v = String(form.get(key) ?? '').trim().replace(/\s+/g, ' ');
  if (v.length > max) throw new FormError(`${key} is too long`);
  return v || null;
}
export function day(form: FormData, key: string): string | null {
  const v = text(form, key);
  if (v && !DAY.test(v)) throw new FormError(`${key} is not a date`);
  return v;
}
function money(form: FormData, key: string): number | null {
  const v = text(form, key)?.replace(/[₹,\s]/g, '');
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new FormError(`${key} is not an amount`);
  return Math.round(n * 100) / 100;
}
function oneOf<T extends string>(form: FormData, key: string, list: readonly T[]): T | null {
  const v = text(form, key);
  if (v && !list.includes(v as T)) throw new FormError(`${key} is not one of the choices`);
  return v as T | null;
}

export function employeeCodeFrom(form: FormData): string {
  const code = (text(form, 'employee_code') ?? '').toUpperCase().replace(/\s+/g, '');
  if (!EMPLOYEE_CODE.test(code)) throw new FormError('Employee ID should look like DBYA0001');
  return code;
}

export function employeeFromForm(form: FormData): EmployeeInput {
  const fullName = text(form, 'full_name');
  if (!fullName) throw new FormError('Name is required');
  const eligible = text(form, 'incentive_eligible');
  const salaryStructure: Record<string, number> = {};
  for (const p of SALARY_PARTS) { const v = money(form, `salary_${p.key}`); if (v !== null) salaryStructure[p.key] = v; }
  const manager = text(form, 'reporting_manager')?.toUpperCase() ?? null;
  if (manager && !EMPLOYEE_CODE.test(manager)) throw new FormError('Reporting manager is not an Employee ID');
  return {
    fullName, dateOfBirth: day(form, 'date_of_birth'), contactNo: text(form, 'contact_no', 30), email: text(form, 'email')?.toLowerCase() ?? null, biometricId: text(form, 'biometric_id', 40),
    company: text(form, 'company'), storeCode: text(form, 'store_code', 40), department: text(form, 'department'), designation: text(form, 'designation'),
    joiningDate: day(form, 'joining_date'), employmentType: oneOf(form, 'employment_type', EMPLOYMENT_TYPES), reportingManager: manager,
    monthlyCtc: money(form, 'monthly_ctc'), salaryStructure, incentiveEligible: eligible === 'yes' ? true : eligible === 'no' ? false : null,
    bankName: text(form, 'bank_name'), bankAccountHolder: text(form, 'bank_account_holder'), bankAccountNo: text(form, 'bank_account_no', 40),
    bankIfsc: text(form, 'bank_ifsc', 20)?.toUpperCase() ?? null, idProofType: text(form, 'id_proof_type', 40), idProofNumber: text(form, 'id_proof_number', 40),
    status: oneOf(form, 'status', STATUSES) ?? 'Active', statusSince: day(form, 'status_since'), exitDate: day(form, 'exit_date'), exitReason: text(form, 'exit_reason', 500),
    emergencyContactName: text(form, 'emergency_contact_name'), emergencyContactRelation: text(form, 'emergency_contact_relation', 60),
    emergencyContactNo: text(form, 'emergency_contact_no', 30), bloodGroup: oneOf(form, 'blood_group', BLOOD_GROUPS), notes: text(form, 'notes', 2000),
    gender: oneOf(form, 'gender', GENDERS), maritalStatus: oneOf(form, 'marital_status', MARITAL_STATUSES), employeeLevel: oneOf(form, 'employee_level', LEVELS),
    team: text(form, 'team', 80), shift: text(form, 'shift', 40), weeklyOff: oneOf(form, 'weekly_off', WEEKDAYS),
  };
}
