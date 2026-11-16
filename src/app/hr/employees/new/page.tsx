import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listEmployees, storeOptions } from '@/lib/hr/employees';
import { PageHeader } from '@/components/ui';
import { EmployeeForm } from '../employee-form';
import { createEmployee } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewEmployeePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const [sp, all, stores] = await Promise.all([searchParams, listEmployees(), storeOptions()]);
  const departments = [...new Set(all.map((e) => e.department).filter((d): d is string => !!d))].sort();
  const error = typeof sp.error === 'string' ? sp.error : null;
  return (
    <main className="mx-auto w-full max-w-[72rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow={<Link href="/hr/employees" className="hover:text-ink">Employees</Link>} title="Add employee" description="Use the Employee ID HR has issued (DBYA0100)." />
      {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <EmployeeForm employee={null} options={{ stores, departments, managers: all }} action={createEmployee} cancelHref="/hr/employees" />
    </main>
  );
}
