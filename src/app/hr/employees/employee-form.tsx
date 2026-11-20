/** The employee form, for adding (/hr/employees/new) and editing (/hr/employees/[code]/edit). Every field but the name may stay empty. */

import Link from 'next/link';
import { BLOOD_GROUPS, EMPLOYMENT_TYPES, GENDERS, ID_PROOF_TYPES, LEVELS, MARITAL_STATUSES, SALARY_PARTS, STATUSES, WEEKDAYS, type Employee } from '@/lib/hr/employees';
import { button, card, control, primaryButton } from '@/components/ui';

type Options = { stores: { code: string; name: string }[]; departments: string[]; managers: { employeeCode: string; fullName: string }[] };

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`flex flex-col gap-1 text-xs font-medium text-ink-2 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>{label}{children}</label>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className={`${card} p-5`}>
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}
const input = `${control} w-full`;

export function EmployeeForm({ employee, options, action, cancelHref }: {
  employee: Employee | null; options: Options; action: (form: FormData) => Promise<void>; cancelHref: string;
}) {
  const e = employee;
  const t = (name: string, value: string | number | null | undefined, type = 'text', extra: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <input name={name} type={type} defaultValue={value ?? ''} className={input} {...extra} />;
  const select = (name: string, value: string | null | undefined, list: readonly (string | { value: string; label: string })[]) =>
    <select name={name} defaultValue={value ?? ''} className={input}>
      <option value="">—</option>
      {list.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>;

  return (
    <form action={action} className="space-y-5">
      {e && <input type="hidden" name="code" value={e.employeeCode} />}
      <Section title="Basic details">
        {!e && <Field label="Employee ID *">{t('employee_code', '', 'text', { required: true, placeholder: 'DBYA0100', pattern: '[A-Za-z]{2,6}[0-9]{2,6}' })}</Field>}
        <Field label="Name *">{t('full_name', e?.fullName, 'text', { required: true })}</Field>
        <Field label="Date of birth">{t('date_of_birth', e?.dateOfBirth, 'date')}</Field>
        <Field label="Contact No.">{t('contact_no', e?.contactNo, 'tel')}</Field>
        <Field label="Email">{t('email', e?.email, 'email')}</Field>
        <Field label="Biometric ID">{t('biometric_id', e?.biometricId)}</Field>
        <Field label="Gender">{select('gender', e?.gender, GENDERS)}</Field>
        <Field label="Marital status">{select('marital_status', e?.maritalStatus, MARITAL_STATUSES)}</Field>
      </Section>

      <Section title="Employment">
        <Field label="Company">{t('company', e?.company)}</Field>
        <Field label="Store">{select('store_code', e?.storeCode, options.stores.map((s) => ({ value: s.code, label: s.name })))}</Field>
        <Field label="Department">{t('department', e?.department, 'text', { list: 'hr-departments' })}</Field>
        <datalist id="hr-departments">{options.departments.map((d) => <option key={d} value={d} />)}</datalist>
        <Field label="Designation">{t('designation', e?.designation)}</Field>
        <Field label="Level">{select('employee_level', e?.employeeLevel, LEVELS)}</Field>
        <Field label="Team">{t('team', e?.team)}</Field>
        <Field label="Shift">{t('shift', e?.shift, 'text', { placeholder: 'Shift 1' })}</Field>
        <Field label="Weekly off">{select('weekly_off', e?.weeklyOff, WEEKDAYS)}</Field>
      </Section>

      <Section title="Joining">
        <Field label="Joining date">{t('joining_date', e?.joiningDate, 'date')}</Field>
        <Field label="Employment type">{select('employment_type', e?.employmentType, EMPLOYMENT_TYPES)}</Field>
        <Field label="Reporting manager">{select('reporting_manager', e?.reportingManager, options.managers.filter((m) => m.employeeCode !== e?.employeeCode).map((m) => ({ value: m.employeeCode, label: `${m.fullName} (${m.employeeCode})` })))}</Field>
      </Section>

      <Section title="Compensation (monthly ₹)">
        <Field label="Monthly CTC">{t('monthly_ctc', e?.monthlyCtc, 'number', { min: 0, step: '0.01' })}</Field>
        <Field label="Incentive eligibility">{select('incentive_eligible', e?.incentiveEligible === null || !e ? null : e.incentiveEligible ? 'yes' : 'no', [{ value: 'yes', label: 'Eligible' }, { value: 'no', label: 'Not eligible' }])}</Field>
        <div className="hidden lg:block" />
        {SALARY_PARTS.map((p) => <Field key={p.key} label={p.label}>{t(`salary_${p.key}`, e?.salaryStructure[p.key], 'number', { min: 0, step: '0.01' })}</Field>)}
      </Section>

      <Section title="Bank details and ID proof">
        <Field label="Bank">{t('bank_name', e?.bankName)}</Field>
        <Field label="Account holder">{t('bank_account_holder', e?.bankAccountHolder)}</Field>
        <Field label="Account number">{t('bank_account_no', e?.bankAccountNo, 'text', { inputMode: 'numeric', autoComplete: 'off' })}</Field>
        <Field label="IFSC">{t('bank_ifsc', e?.bankIfsc)}</Field>
        <Field label="ID proof">{select('id_proof_type', e?.idProofType, ID_PROOF_TYPES)}</Field>
        <Field label="ID proof number">{t('id_proof_number', e?.idProofNumber, 'text', { autoComplete: 'off' })}</Field>
      </Section>

      <Section title="Status">
        <Field label="Status">{select('status', e?.status ?? 'Active', STATUSES)}</Field>
        <Field label="Since">{t('status_since', e?.statusSince, 'date')}</Field>
        <Field label="Exit date">{t('exit_date', e?.exitDate, 'date')}</Field>
        <Field label="Exit reason" wide>{t('exit_reason', e?.exitReason)}</Field>
      </Section>

      <Section title="Emergency contact and health">
        <Field label="Emergency contact name">{t('emergency_contact_name', e?.emergencyContactName)}</Field>
        <Field label="Relation">{t('emergency_contact_relation', e?.emergencyContactRelation)}</Field>
        <Field label="Emergency number">{t('emergency_contact_no', e?.emergencyContactNo, 'tel')}</Field>
        <Field label="Blood group">{select('blood_group', e?.bloodGroup, BLOOD_GROUPS)}</Field>
        <Field label="Notes" wide><textarea name="notes" defaultValue={e?.notes ?? ''} rows={3} className={input} /></Field>
      </Section>

      <p className="text-xs text-ink-muted">Family members, documents, transfers, promotions and increments are added on the employee page.</p>
      <div className="flex gap-2">
        <button type="submit" className={primaryButton}>{e ? 'Save' : 'Add employee'}</button>
        <Link href={cancelHref} className={button}>Cancel</Link>
      </div>
    </form>
  );
}
