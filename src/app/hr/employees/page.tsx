/** Employees: the employee master, searchable by name or ID and filtered by department and status. */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listEmployees } from '@/lib/hr/employees';
import { formatDate, formatNumber } from '@/lib/format';
import { button, card, eyebrow, PageHeader, primaryButton } from '@/components/ui';
import { pickRange, pickStores } from '@/lib/module-filters';
import { storeMatches } from '@/lib/store-filter';
import { StatusBadge } from '../status-badge';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const q = one(sp.q).trim(), dept = one(sp.department), status = one(sp.status);
  const stores = pickStores(sp);
  const joined = pickRange(sp, { from: null, to: null });
  const all = await listEmployees();
  const needle = q.toUpperCase();
  const rows = all.filter((e) =>
    (!needle || e.fullName.toUpperCase().includes(needle) || e.employeeCode.includes(needle) || (e.designation ?? '').toUpperCase().includes(needle))
    && (!dept || e.department === dept) && (!status || e.status === status) && storeMatches(stores, e.storeCode)
    && (!joined.picked || (!!e.joiningDate && (!joined.from || e.joiningDate >= joined.from) && (!joined.to || e.joiningDate <= joined.to))));

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Employees"
        description="Everyone on the payroll, by Employee ID. Open a name for their full record."
        meta={`${formatNumber(rows.length)} of ${formatNumber(all.length)} employees`}
        actions={<><Link href="/hr/employees/import" className={button}>Import details</Link><Link href="/hr/employees/new" className={primaryButton}>Add employee</Link></>}
      />


      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '60rem' }}>
            <thead><tr className={eyebrow}>
              {['Employee ID', 'Name', 'Department', 'Designation', 'Store', 'Contact No.', 'Joined', 'Status'].map((h) =>
                <th key={h} scope="col" className="whitespace-nowrap px-3 py-3 text-left font-bold">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.employeeCode} className="border-t border-grid hover:bg-inset/50">
                  <td className="tnum whitespace-nowrap px-3 py-2 text-ink-2">{e.employeeCode}</td>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    <Link href={`/hr/employees/${e.employeeCode}`} className="hover:text-accent hover:underline">{e.fullName}</Link>
                  </th>
                  <td className="px-3 py-2 text-ink-2">{e.department ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-2">{e.designation ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-2">{e.storeName ?? '—'}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-ink-2">{e.contactNo ?? '—'}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-ink-2">{e.joiningDate ? formatDate(e.joiningDate) : '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={e.status} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-muted">No employee matches.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
