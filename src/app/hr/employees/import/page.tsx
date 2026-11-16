/** Import employee details from the HRMS "Employee Basic Details" Excel export. */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { card, primaryButton, PageHeader } from '@/components/ui';
import { formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ImportDetailsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const skipped = one('skipped').split(',').filter(Boolean);
  const issues = one('issues').split('\n').filter(Boolean);

  return (
    <main className="mx-auto w-full max-w-[56rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow={<Link href="/hr/employees" className="hover:text-ink">Employees</Link>} title="Import employee details"
        description="Upload the HRMS “Employee Basic Details” export. It fills date of birth, Contact No. and Biometric ID for employees already on the list, matched by EMP ID, and an email only where none is set." />

      {one('error') && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">{one('error')}</p>}
      {one('rows') && (
        <section className={`${card} space-y-2 p-5 text-sm`} aria-live="polite">
          <h2 className="font-semibold text-ink">Imported</h2>
          <p className="text-ink-2">{formatNumber(one('rows'))} rows read · <b className="text-ink">{formatNumber(one('updated'))} employees updated</b> · {formatNumber(one('unchanged'))} already up to date</p>
          {skipped.length > 0 && <p className="text-ink-2">Not on the employee list, so left out ({skipped.length}): {skipped.join(', ')}. Add them under Employees first if they work here.</p>}
          {issues.length > 0 && <div><p className="text-ink-2">Check these:</p><ul className="ml-5 list-disc text-ink-2">{issues.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          <p><Link href="/hr/employees" className="text-accent hover:underline">Back to Employees</Link></p>
        </section>
      )}

      <form action="/hr/employees/import/upload" method="post" encType="multipart/form-data" className={`${card} space-y-4 p-5`}>
        <label className="block text-sm font-medium text-ink">Excel file (.xlsx)
          <input type="file" name="file" accept=".xlsx,.xls" required className="mt-2 block w-full text-sm text-ink-2 file:mr-3 file:rounded-xl file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-sm file:text-ink" />
        </label>
        <p className="text-xs text-ink-muted">Only EMP ID, Display Name, Email, Mobile Number, Date Of Birth and Biometric Id are read. Aadhaar, PAN, bank and every other column in the file are ignored. Uploading the same file again changes nothing.</p>
        <button type="submit" className={primaryButton}>Import</button>
      </form>
    </main>
  );
}
