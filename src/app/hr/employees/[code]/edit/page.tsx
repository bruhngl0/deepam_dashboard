import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getEmployee, listEmployees, storeOptions } from '@/lib/hr/employees';
import { PageHeader } from '@/components/ui';
import { EmployeeForm } from '../../employee-form';
import { updateEmployee } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function EditEmployeePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const [employee, all, stores] = await Promise.all([getEmployee(code.toUpperCase()), listEmployees(), storeOptions()]);
  if (!employee) notFound();
  const departments = [...new Set(all.map((e) => e.department).filter((d): d is string => !!d))].sort();
  const error = typeof sp.error === 'string' ? sp.error : null;
  return (
    <main className="mx-auto w-full max-w-[72rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow={<><Link href="/hr/employees" className="hover:text-ink">Employees</Link> · {employee.employeeCode}</>} title={`Edit ${employee.fullName}`} />
      {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <EmployeeForm employee={employee} options={{ stores, departments, managers: all }} action={updateEmployee} cancelHref={`/hr/employees/${employee.employeeCode}`} />
    </main>
  );
}
