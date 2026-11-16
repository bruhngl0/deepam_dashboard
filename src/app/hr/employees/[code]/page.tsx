/** One employee: every HR record, plus family, documents, history and the salesperson they sell as. */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { DOCUMENT_KINDS, employeeRecords, getEmployee, HISTORY_KINDS, SALARY_PARTS, salespersonOptions } from '@/lib/hr/employees';
import { formatCurrency, formatDate } from '@/lib/format';
import { button, card, control, eyebrow, PageHeader } from '@/components/ui';
import { StatusBadge } from '../../status-badge';
import { addRecord, deleteRecord, linkSalesperson } from '../actions';

export const dynamic = 'force-dynamic';

const show = (v: React.ReactNode) => (v === null || v === undefined || v === '' ? <span className="text-ink-muted">—</span> : v);
const mask = (v: string | null) => (v && v.length > 4 ? `•••• ${v.slice(-4)}` : v);

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={`${card} p-5`}>
      <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ink">{title}</h2>{action}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => <div key={k}><dt className={eyebrow}>{k}</dt><dd className="mt-0.5 text-sm text-ink">{show(v)}</dd></div>)}
    </dl>
  );
}
function Remove({ code, record, id, label }: { code: string; record: string; id: number; label: string }) {
  return (
    <form action={deleteRecord}>
      <input type="hidden" name="code" value={code} /><input type="hidden" name="record" value={record} /><input type="hidden" name="id" value={id} />
      <button type="submit" className="text-xs text-ink-muted hover:text-red-600" aria-label={`Remove ${label}`}>Remove</button>
    </form>
  );
}
const small = `${control} w-full`;

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const e = await getEmployee(code.toUpperCase());
  if (!e) notFound();
  const [records, salespeople] = await Promise.all([employeeRecords(e.employeeCode), salespersonOptions()]);
  const error = typeof sp.error === 'string' ? sp.error : null;
  const linked = salespeople?.find((s) => s.key === e.salespersonKey);
  const salaryLines = SALARY_PARTS.filter((p) => e.salaryStructure[p.key] !== undefined);
  const hidden = <input type="hidden" name="code" value={e.employeeCode} />;

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={<><Link href="/hr/employees" className="hover:text-ink">Employees</Link> · {e.employeeCode}</>}
        title={e.fullName}
        description={[e.designation, e.department, e.storeName].filter(Boolean).join(' · ') || undefined}
        meta={<StatusBadge status={e.status} />}
        actions={<>
          {e.salespersonKey && <Link href={`/hr/salespeople/${e.employeeCode}`} className={button}>Sales performance</Link>}
          <Link href={`/hr/employees/${e.employeeCode}/edit`} className={button}>Edit details</Link>
        </>}
      />
      {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Basic details">
          <Facts items={[['Employee ID', e.employeeCode], ['Name', e.fullName], ['Date of birth', e.dateOfBirth && formatDate(e.dateOfBirth)], ['Contact No.', e.contactNo], ['Email', e.email], ['Blood group', e.bloodGroup]]} />
        </Panel>
        <Panel title="Employment and joining">
          <Facts items={[['Company', e.company], ['Store', e.storeName ?? e.storeCode], ['Department', e.department], ['Designation', e.designation],
            ['Joining date', e.joiningDate && formatDate(e.joiningDate)], ['Employment type', e.employmentType],
            ['Reporting manager', e.reportingManager && <Link href={`/hr/employees/${e.reportingManager}`} className="text-accent hover:underline">{e.reportingManagerName ?? e.reportingManager}</Link>]]} />
        </Panel>
        <Panel title="Compensation">
          <Facts items={[['Monthly CTC', e.monthlyCtc !== null && formatCurrency(e.monthlyCtc)], ['Incentive eligibility', e.incentiveEligible === null ? null : e.incentiveEligible ? 'Eligible' : 'Not eligible']]} />
          <div className="mt-4">
            <p className={eyebrow}>Salary structure</p>
            {salaryLines.length ? (
              <table className="mt-1 w-full text-sm"><tbody>
                {salaryLines.map((p) => <tr key={p.key} className="border-t border-grid"><th scope="row" className="py-1 text-left font-normal text-ink-2">{p.label}</th><td className="tnum py-1 text-right text-ink">{'deduction' in p ? '− ' : ''}{formatCurrency(e.salaryStructure[p.key])}</td></tr>)}
              </tbody></table>
            ) : <p className="mt-0.5 text-sm text-ink-muted">—</p>}
          </div>
        </Panel>
        <Panel title="Status">
          <Facts items={[['Status', <StatusBadge key="s" status={e.status} />], ['Since', e.statusSince && formatDate(e.statusSince)], ['Exit date', e.exitDate && formatDate(e.exitDate)], ['Exit reason', e.exitReason]]} />
        </Panel>
        <Panel title="Bank details and ID proof">
          <Facts items={[['Bank', e.bankName], ['Account holder', e.bankAccountHolder], ['Account number', mask(e.bankAccountNo)], ['IFSC', e.bankIfsc], ['ID proof', e.idProofType], ['ID proof number', mask(e.idProofNumber)]]} />
          <p className="mt-3 text-xs text-ink-muted">Account and ID numbers show only their last four digits here; Edit details shows them in full.</p>
        </Panel>
        <Panel title="Emergency contact">
          <Facts items={[['Name', e.emergencyContactName], ['Relation', e.emergencyContactRelation], ['Number', e.emergencyContactNo]]} />
          {e.notes && <p className="mt-3 whitespace-pre-line text-sm text-ink-2">{e.notes}</p>}
        </Panel>
      </div>

      <Panel title="Documents">
        {records.documents.length ? (
          <ul className="divide-y divide-grid text-sm">
            {records.documents.map((d) => <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <span><span className="text-ink-2">{d.kind}</span>{' · '}<a href={d.url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{d.title ?? 'Open'}</a></span>
              <Remove code={e.employeeCode} record="documents" id={d.id} label={d.kind} />
            </li>)}
          </ul>
        ) : <p className="text-sm text-ink-muted">No documents yet: appointment letter, ID proof and bank details go here.</p>}
        <form action={addRecord} className="mt-3 grid gap-2 sm:grid-cols-[12rem_1fr_2fr_auto]">
          {hidden}<input type="hidden" name="record" value="documents" />
          <select name="kind" className={small} aria-label="Document type" required defaultValue=""><option value="" disabled>Type</option>{DOCUMENT_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <input name="title" placeholder="Title (optional)" className={small} aria-label="Title" />
          <input name="url" type="url" placeholder="Link to the file (Google Drive…)" className={small} aria-label="Link" required />
          <button type="submit" className={button}>Add</button>
        </form>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Family details">
          {records.family.length ? (
            <ul className="divide-y divide-grid text-sm">
              {records.family.map((f) => <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                <span><span className="font-medium text-ink">{f.name}</span> <span className="text-ink-2">· {f.relation}{f.dateOfBirth ? ` · born ${formatDate(f.dateOfBirth)}` : ''}{f.contactNo ? ` · ${f.contactNo}` : ''}</span></span>
                <Remove code={e.employeeCode} record="family" id={f.id} label={f.name} />
              </li>)}
            </ul>
          ) : <p className="text-sm text-ink-muted">No family members yet.</p>}
          <form action={addRecord} className="mt-3 grid gap-2 sm:grid-cols-2">
            {hidden}<input type="hidden" name="record" value="family" />
            <input name="name" placeholder="Name" className={small} aria-label="Family member name" required />
            <input name="relation" placeholder="Relation (Spouse, Son…)" className={small} aria-label="Relation" required />
            <input name="date_of_birth" type="date" className={small} aria-label="Date of birth" />
            <input name="contact_no" type="tel" placeholder="Contact No." className={small} aria-label="Contact No." />
            <button type="submit" className={`${button} sm:col-span-2 sm:justify-self-start`}>Add family member</button>
          </form>
        </Panel>

        <Panel title="History: transfers, promotions, increments">
          {records.history.length ? (
            <ul className="divide-y divide-grid text-sm">
              {records.history.map((h) => <li key={h.id} className="flex items-start justify-between gap-3 py-2">
                <span>
                  <span className="tnum text-ink-muted">{formatDate(h.effectiveOn)}</span> <span className="font-medium text-ink">{h.kind}</span>
                  {(h.fromValue || h.toValue) && <span className="text-ink-2"> · {h.fromValue ?? '—'} → {h.toValue ?? '—'}</span>}
                  {h.note && <span className="block text-xs text-ink-muted">{h.note}</span>}
                </span>
                <Remove code={e.employeeCode} record="history" id={h.id} label={`${h.kind} on ${h.effectiveOn}`} />
              </li>)}
            </ul>
          ) : <p className="text-sm text-ink-muted">No transfers, promotions or increments yet.</p>}
          <form action={addRecord} className="mt-3 grid gap-2 sm:grid-cols-2">
            {hidden}<input type="hidden" name="record" value="history" />
            <select name="kind" className={small} aria-label="Type" required defaultValue=""><option value="" disabled>Type</option>{HISTORY_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <input name="effective_on" type="date" className={small} aria-label="Effective from" required />
            <input name="from_value" placeholder="From (store, designation, ₹)" className={small} aria-label="From" />
            <input name="to_value" placeholder="To" className={small} aria-label="To" />
            <input name="note" placeholder="Note" className={`${small} sm:col-span-2`} aria-label="Note" />
            <button type="submit" className={`${button} sm:col-span-2 sm:justify-self-start`}>Add to history</button>
          </form>
        </Panel>
      </div>

      <Panel title="Salesperson on the sales sheet">
        <p className="text-sm text-ink-2">
          {e.salespersonKey
            ? <>Sells as <b className="text-ink">{linked?.name ?? e.salespersonKey}</b> ({e.salespersonLink === 'auto' ? 'matched by name' : 'picked by HR'}). Their bills, walk-ins and incentives show under {e.employeeCode}.</>
            : e.salespersonLink === 'none' ? 'Marked as not a salesperson.' : 'Not matched to a salesperson. Names with the same words are matched automatically; pick one here if the sales sheet spells it differently.'}
        </p>
        {salespeople ? (
          <form action={linkSalesperson} className="mt-3 flex flex-wrap gap-2">
            {hidden}
            <select name="salesperson" defaultValue={e.salespersonLink === 'manual' ? e.salespersonKey ?? '' : e.salespersonLink === 'none' ? 'none' : 'auto'} className={`${control} min-w-64`} aria-label="Salesperson">
              <option value="auto">Match by name automatically</option>
              <option value="none">Not a salesperson</option>
              <optgroup label="Salespeople on the sales sheet">
                {salespeople.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </optgroup>
            </select>
            <button type="submit" className={button}>Save</button>
          </form>
        ) : <p className="mt-2 text-xs text-ink-muted">The analytics database is not connected here, so salespeople cannot be listed.</p>}
      </Panel>
    </main>
  );
}
