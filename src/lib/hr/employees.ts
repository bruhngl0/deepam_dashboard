/**
 * The employee master (drizzle/0036): reads and writes for HR Intelligence, and the link from an analytics
 * salesperson (internal key EMP-0001) to the employee they are, so pages show the Employee ID (DBYA0001).
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { aq } from '@/lib/analytics/db';
import { autoLinks, type SalespersonOption } from './match';
import type { BasicDetails } from './import-details';

export { nameKey, type SalespersonOption } from './match';

const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));

export const EMPLOYEE_CODE = /^[A-Z]{2,6}[0-9]{2,6}$/;
/** The analytics database's own key for a salesperson; only used inside URLs for people with no employee record. */
export const SALESPERSON_KEY = /^EMP-[0-9]{4}$/;

export const STATUSES = ['Active', 'On leave', 'Resigned', 'Exited'] as const;
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Weekend staff'] as const;
export const GENDERS = ['Male', 'Female', 'Other'] as const;
export const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed'] as const;
/** L0 directors, L1 department heads, L2 managers and senior staff, L3 everyone else (the "Employee Levels" sheet). */
export const LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const HISTORY_KINDS = ['Transfer', 'Promotion', 'Increment', 'Other'] as const;
export const DOCUMENT_KINDS = ['Appointment letter', 'ID proof', 'Bank details', 'Other'] as const;
export const ID_PROOF_TYPES = ['Aadhaar', 'PAN', 'Passport', 'Voter ID', 'Driving licence'] as const;
/** Salary structure lines (employees.salary_structure), monthly ₹. */
export const SALARY_PARTS = [
  { key: 'basic', label: 'Basic' },
  { key: 'hra', label: 'HRA' },
  { key: 'special', label: 'Special allowance' },
  { key: 'other', label: 'Other allowances' },
  { key: 'pf', label: 'PF (employee)', deduction: true },
  { key: 'esi', label: 'ESI (employee)', deduction: true },
  { key: 'pt', label: 'Professional tax', deduction: true },
] as const;

export type Employee = {
  employeeCode: string; fullName: string; dateOfBirth: string | null; contactNo: string | null; email: string | null; biometricId: string | null;
  company: string | null; storeCode: string | null; storeName: string | null; department: string | null; designation: string | null;
  joiningDate: string | null; employmentType: string | null; reportingManager: string | null; reportingManagerName: string | null;
  monthlyCtc: number | null; salaryStructure: Record<string, number>; incentiveEligible: boolean | null;
  bankName: string | null; bankAccountHolder: string | null; bankAccountNo: string | null; bankIfsc: string | null;
  idProofType: string | null; idProofNumber: string | null;
  status: (typeof STATUSES)[number]; statusSince: string | null; exitDate: string | null; exitReason: string | null;
  emergencyContactName: string | null; emergencyContactRelation: string | null; emergencyContactNo: string | null;
  bloodGroup: string | null; notes: string | null;
  gender: string | null; maritalStatus: string | null; employeeLevel: string | null; team: string | null; shift: string | null; weeklyOff: string | null;
  salespersonKey: string | null; salespersonLink: 'auto' | 'manual' | 'none' | null;
};

const SELECT = sql`
  SELECT e.*, to_char(e.date_of_birth, 'YYYY-MM-DD') AS dob, to_char(e.joining_date, 'YYYY-MM-DD') AS joined,
         to_char(e.status_since, 'YYYY-MM-DD') AS since, to_char(e.exit_date, 'YYYY-MM-DD') AS exited,
         s.name AS store_name, m.full_name AS manager_name
  FROM employees e LEFT JOIN stores s ON s.code = e.store_code LEFT JOIN employees m ON m.employee_code = e.reporting_manager`;

const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
function toEmployee(r: Record<string, unknown>): Employee {
  return {
    employeeCode: String(r.employee_code), fullName: String(r.full_name), dateOfBirth: str(r.dob), contactNo: str(r.contact_no), email: str(r.email), biometricId: str(r.biometric_id),
    company: str(r.company), storeCode: str(r.store_code), storeName: str(r.store_name), department: str(r.department), designation: str(r.designation),
    joiningDate: str(r.joined), employmentType: str(r.employment_type), reportingManager: str(r.reporting_manager), reportingManagerName: str(r.manager_name),
    monthlyCtc: r.monthly_ctc === null || r.monthly_ctc === undefined ? null : Number(r.monthly_ctc),
    salaryStructure: Object.fromEntries(Object.entries((r.salary_structure as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v)])),
    incentiveEligible: r.incentive_eligible === null || r.incentive_eligible === undefined ? null : Boolean(r.incentive_eligible),
    bankName: str(r.bank_name), bankAccountHolder: str(r.bank_account_holder), bankAccountNo: str(r.bank_account_no), bankIfsc: str(r.bank_ifsc),
    idProofType: str(r.id_proof_type), idProofNumber: str(r.id_proof_number),
    status: String(r.status) as Employee['status'], statusSince: str(r.since), exitDate: str(r.exited), exitReason: str(r.exit_reason),
    emergencyContactName: str(r.emergency_contact_name), emergencyContactRelation: str(r.emergency_contact_relation), emergencyContactNo: str(r.emergency_contact_no),
    bloodGroup: str(r.blood_group), notes: str(r.notes),
    gender: str(r.gender), maritalStatus: str(r.marital_status), employeeLevel: str(r.employee_level), team: str(r.team), shift: str(r.shift), weeklyOff: str(r.weekly_off),
    salespersonKey: str(r.salesperson_key), salespersonLink: str(r.salesperson_link) as Employee['salespersonLink'],
  };
}

export async function listEmployees(): Promise<Employee[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`${SELECT} ORDER BY e.department NULLS LAST, e.employee_code`)).map(toEmployee);
}

export async function getEmployee(code: string): Promise<Employee | null> {
  if (!EMPLOYEE_CODE.test(code)) return null;
  const r = rowsOf<Record<string, unknown>>(await db.execute(sql`${SELECT} WHERE e.employee_code = ${code}`))[0];
  return r ? toEmployee(r) : null;
}

export type FamilyMember = { id: number; name: string; relation: string; dateOfBirth: string | null; contactNo: string | null };
export type HistoryEntry = { id: number; kind: string; effectiveOn: string; fromValue: string | null; toValue: string | null; note: string | null };
export type EmployeeDocument = { id: number; kind: string; title: string | null; url: string };

export async function employeeRecords(code: string) {
  const [family, history, documents] = await Promise.all([
    db.execute(sql`SELECT id, name, relation, to_char(date_of_birth, 'YYYY-MM-DD') AS dob, contact_no FROM employee_family WHERE employee_code = ${code} ORDER BY id`),
    db.execute(sql`SELECT id, kind, to_char(effective_on, 'YYYY-MM-DD') AS on, from_value, to_value, note FROM employee_history WHERE employee_code = ${code} ORDER BY effective_on DESC, id DESC`),
    db.execute(sql`SELECT id, kind, title, url FROM employee_documents WHERE employee_code = ${code} ORDER BY kind, id`),
  ]);
  return {
    family: rowsOf<Record<string, unknown>>(family).map((r): FamilyMember => ({ id: Number(r.id), name: String(r.name), relation: String(r.relation), dateOfBirth: str(r.dob), contactNo: str(r.contact_no) })),
    history: rowsOf<Record<string, unknown>>(history).map((r): HistoryEntry => ({ id: Number(r.id), kind: String(r.kind), effectiveOn: String(r.on), fromValue: str(r.from_value), toValue: str(r.to_value), note: str(r.note) })),
    documents: rowsOf<Record<string, unknown>>(documents).map((r): EmployeeDocument => ({ id: Number(r.id), kind: String(r.kind), title: str(r.title), url: String(r.url) })),
  };
}

export async function storeOptions(): Promise<{ code: string; name: string }[]> {
  return rowsOf<{ code: string; name: string }>(await db.execute(sql`SELECT code, name FROM stores ORDER BY store_code NULLS LAST, name`));
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────────

/** The fields the employee form edits, already validated (see ./form.ts). */
export type EmployeeInput = Omit<Employee, 'employeeCode' | 'storeName' | 'reportingManagerName' | 'salespersonKey' | 'salespersonLink'>;

export async function saveEmployee(code: string, e: EmployeeInput, create: boolean): Promise<void> {
  const v = sql`${e.fullName}, ${e.dateOfBirth}, ${e.contactNo}, ${e.email}, ${e.biometricId},${e.company}, ${e.storeCode}, ${e.department}, ${e.designation},
    ${e.joiningDate}, ${e.employmentType}, ${e.reportingManager}, ${e.monthlyCtc}, ${JSON.stringify(e.salaryStructure)}::jsonb, ${e.incentiveEligible},
    ${e.bankName}, ${e.bankAccountHolder}, ${e.bankAccountNo}, ${e.bankIfsc}, ${e.idProofType}, ${e.idProofNumber},
    ${e.status}, ${e.statusSince}, ${e.exitDate}, ${e.exitReason}, ${e.emergencyContactName}, ${e.emergencyContactRelation}, ${e.emergencyContactNo},
    ${e.bloodGroup}, ${e.notes}, ${e.gender}, ${e.maritalStatus}, ${e.employeeLevel}, ${e.team}, ${e.shift}, ${e.weeklyOff}`;
  const cols = sql.raw(`full_name, date_of_birth, contact_no, email, biometric_id,company, store_code, department, designation,
    joining_date, employment_type, reporting_manager, monthly_ctc, salary_structure, incentive_eligible,
    bank_name, bank_account_holder, bank_account_no, bank_ifsc, id_proof_type, id_proof_number,
    status, status_since, exit_date, exit_reason, emergency_contact_name, emergency_contact_relation, emergency_contact_no, blood_group, notes,
    gender, marital_status, employee_level, team, shift, weekly_off`);
  if (create) {
    await db.execute(sql`INSERT INTO employees (employee_code, ${cols}) VALUES (${code}, ${v})`);
  } else {
    await db.execute(sql`UPDATE employees SET (${cols}, updated_at) = (${v}, now()) WHERE employee_code = ${code}`);
  }
  // Hemparshwa's Auth Control follows at once: someone marked Exited loses access to every app now.
  const { sendHrPeopleNow } = await import('@/lib/integration/hemparshwa-people');
  await sendHrPeopleNow();
}

/**
 * Basic details from the HRMS sheet (./import-details.ts) for employees already on the list: date of birth,
 * Contact No. and Biometric ID take the sheet's value when it has one; email only fills an empty one, so
 * corrections HR made here stay. People not on the list are left out and reported.
 */
export async function applyBasicDetails(rows: BasicDetails[]) {
  const known = new Set(rowsOf<{ employee_code: string }>(await db.execute(sql`SELECT employee_code FROM employees`)).map((r) => r.employee_code));
  const notOnList = rows.filter((r) => !known.has(r.employeeCode)).map((r) => r.employeeCode);
  const conflicts: string[] = [];
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const row of rows.filter((x) => known.has(x.employeeCode))) {
      let bio = row.biometricId;
      if (bio) {
        const other = rowsOf<{ employee_code: string }>(await tx.execute(sql`SELECT employee_code FROM employees WHERE biometric_id = ${bio} AND employee_code <> ${row.employeeCode}`))[0];
        if (other) { conflicts.push(`${row.employeeCode}: Biometric ID ${bio} is already ${other.employee_code}'s`); bio = null; }
      }
      const res = rowsOf(await tx.execute(sql`
        WITH n AS (SELECT ${row.dateOfBirth}::date AS dob, ${row.contactNo}::text AS phone, ${bio}::text AS bio, ${row.email}::text AS email)
        UPDATE employees e SET date_of_birth = COALESCE(n.dob, e.date_of_birth), contact_no = COALESCE(n.phone, e.contact_no),
          biometric_id = COALESCE(n.bio, e.biometric_id), email = COALESCE(e.email, n.email), updated_at = now()
        FROM n
        WHERE e.employee_code = ${row.employeeCode}
          AND (e.date_of_birth IS DISTINCT FROM COALESCE(n.dob, e.date_of_birth) OR e.contact_no IS DISTINCT FROM COALESCE(n.phone, e.contact_no)
            OR e.biometric_id IS DISTINCT FROM COALESCE(n.bio, e.biometric_id) OR e.email IS DISTINCT FROM COALESCE(e.email, n.email))
        RETURNING 1`));
      updated += res.length;
    }
  });
  if (updated) {
    const { sendHrPeopleNow } = await import('@/lib/integration/hemparshwa-people');
    await sendHrPeopleNow();
  }
  return { updated, unchanged: rows.length - notOnList.length - updated, notOnList, conflicts };
}

export async function employeeExists(code: string): Promise<boolean> {
  return rowsOf(await db.execute(sql`SELECT 1 FROM employees WHERE employee_code = ${code}`)).length > 0;
}

export async function addFamilyMember(code: string, m: Omit<FamilyMember, 'id'>) {
  await db.execute(sql`INSERT INTO employee_family (employee_code, name, relation, date_of_birth, contact_no) VALUES (${code}, ${m.name}, ${m.relation}, ${m.dateOfBirth}, ${m.contactNo})`);
}
export async function addHistory(code: string, h: Omit<HistoryEntry, 'id'>) {
  await db.execute(sql`INSERT INTO employee_history (employee_code, kind, effective_on, from_value, to_value, note) VALUES (${code}, ${h.kind}, ${h.effectiveOn}, ${h.fromValue}, ${h.toValue}, ${h.note})`);
}
export async function addDocument(code: string, d: Omit<EmployeeDocument, 'id'>) {
  await db.execute(sql`INSERT INTO employee_documents (employee_code, kind, title, url) VALUES (${code}, ${d.kind}, ${d.title}, ${d.url})`);
}
const RECORD_TABLES = { family: 'employee_family', history: 'employee_history', documents: 'employee_documents' } as const;
export async function removeRecord(code: string, table: keyof typeof RECORD_TABLES, id: number) {
  await db.execute(sql`DELETE FROM ${sql.identifier(RECORD_TABLES[table])} WHERE id = ${id} AND employee_code = ${code}`);
}

// ── Salesperson ↔ employee ──────────────────────────────────────────────────────────────────────────


/** Every analytics salesperson; null when analytics is not connected. */
export async function salespersonOptions(): Promise<SalespersonOption[] | null> {
  const rows = await aq<{ emp_code: string; name: string; store_code: string | null }>('SELECT emp_code, name, store_code FROM analytics.dim_salesperson ORDER BY name');
  return rows ? rows.map((r) => ({ key: r.emp_code, name: r.name, storeCode: r.store_code })) : null;
}

export async function linkSalespeopleByName(): Promise<number> {
  const salespeople = await salespersonOptions();
  if (!salespeople) return 0;
  const employees = rowsOf<{ employee_code: string; full_name: string; salesperson_key: string | null; salesperson_link: string | null }>(
    await db.execute(sql`SELECT employee_code, full_name, salesperson_key, salesperson_link FROM employees`));
  const links = autoLinks(employees.map((e) => ({ employeeCode: e.employee_code, fullName: e.full_name, salespersonKey: e.salesperson_key, salespersonLink: e.salesperson_link })), salespeople);
  for (const l of links) {
    await db.execute(sql`UPDATE employees SET salesperson_key = ${l.key}, salesperson_link = 'auto', updated_at = now()
      WHERE employee_code = ${l.employeeCode} AND salesperson_key IS NULL AND salesperson_link IS NULL
        AND NOT EXISTS (SELECT 1 FROM employees o WHERE o.salesperson_key = ${l.key})`);
  }
  return links.length;
}

/** HR's pick on the employee page: a salesperson key, or null for "not a salesperson". */
export async function setSalespersonLink(code: string, key: string | null): Promise<void> {
  if (key !== null && !SALESPERSON_KEY.test(key)) throw new Error(`Not a salesperson: ${key}`);
  await db.transaction(async (tx) => {
    if (key) await tx.execute(sql`UPDATE employees SET salesperson_key = NULL, salesperson_link = NULL, updated_at = now() WHERE salesperson_key = ${key} AND employee_code <> ${code}`);
    await tx.execute(sql`UPDATE employees SET salesperson_key = ${key}, salesperson_link = ${key ? 'manual' : 'none'}, updated_at = now() WHERE employee_code = ${code}`);
  });
}

/** Lets matching by name try again for this employee. */
export async function clearSalespersonLink(code: string): Promise<void> {
  await db.execute(sql`UPDATE employees SET salesperson_key = NULL, salesperson_link = NULL, updated_at = now() WHERE employee_code = ${code}`);
}

export type EmployeeRef = { employeeCode: string; fullName: string };

/** Salesperson key → the employee they are. */
export async function employeesBySalesperson(): Promise<Map<string, EmployeeRef>> {
  const rows = rowsOf<{ salesperson_key: string; employee_code: string; full_name: string }>(
    await db.execute(sql`SELECT salesperson_key, employee_code, full_name FROM employees WHERE salesperson_key IS NOT NULL`));
  return new Map(rows.map((r) => [r.salesperson_key, { employeeCode: r.employee_code, fullName: r.full_name }]));
}

/** The URL id for a salesperson: their Employee ID, or the internal key when they have no employee record. */
export const salespersonSlug = (key: string, ids: Map<string, EmployeeRef>) => ids.get(key)?.employeeCode ?? key;

/** A salesperson URL id (Employee ID or internal key) → the internal key and the employee, if any. */
export async function resolveSalesperson(slug: string): Promise<{ key: string; employee: EmployeeRef | null } | null> {
  if (EMPLOYEE_CODE.test(slug)) {
    const r = rowsOf<{ salesperson_key: string | null; full_name: string }>(await db.execute(sql`SELECT salesperson_key, full_name FROM employees WHERE employee_code = ${slug}`))[0];
    return r?.salesperson_key ? { key: r.salesperson_key, employee: { employeeCode: slug, fullName: r.full_name } } : null;
  }
  if (!SALESPERSON_KEY.test(slug)) return null;
  const ids = await employeesBySalesperson();
  return { key: slug, employee: ids.get(slug) ?? null };
}
