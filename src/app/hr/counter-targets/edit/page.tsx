/** Set one store's counter targets for a month. Rows left empty are dropped; clearing a row removes it. */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listEmployees } from '@/lib/hr/employees';
import { isTargetStore, MONTH, TARGET_STORES, targetsFor } from '@/lib/hr/counter-targets';
import { todayIst } from '@/lib/queries/daily';
import { button, card, control, eyebrow, PageHeader, primaryButton } from '@/components/ui';
import { saveCounterTargets } from '../actions';

export const dynamic = 'force-dynamic';

export default async function EditCounterTargetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const store = sp.store, month = typeof sp.month === 'string' && MONTH.test(sp.month) ? sp.month : todayIst().slice(0, 7);
  if (!isTargetStore(store)) notFound();
  const name = TARGET_STORES.find((s) => s.code === store)!.name;
  const [targets, employees] = await Promise.all([targetsFor(month), listEmployees()]);
  const rows = [...targets.filter((t) => t.storeCode === store), ...Array.from({ length: 3 }, () => null)];
  const error = typeof sp.error === 'string' ? sp.error : null;
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const input = `${control} w-full`;

  return (
    <main className="mx-auto w-full max-w-[80rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow={<Link href={`/hr/counter-targets?month=${month}`} className="hover:text-ink">Counter targets</Link>} title={`${name} targets · ${monthLabel}`}
        description='Write the counters as on the circular: codes separated by commas, "below 5000" or "above 5000" for a tag-price band, and "+" between lists, e.g. 16, 17, 14, 15 below 5000 + 03.' />
      {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

      <form action={saveCounterTargets} className="space-y-4">
        <input type="hidden" name="store" value={store} /><input type="hidden" name="month" value={month} />
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full border-collapse text-sm" style={{ minWidth: '56rem' }}>
            <thead><tr className={eyebrow}>
              <th scope="col" className="px-3 py-3 text-left font-bold">Counters</th>
              <th scope="col" className="px-3 py-3 text-left font-bold">Sales assistants (names or Employee IDs)</th>
              <th scope="col" className="w-32 px-3 py-3 text-right font-bold">Target 1</th>
              <th scope="col" className="w-32 px-3 py-3 text-right font-bold">Target 2</th>
            </tr></thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={t?.id ?? `new-${i}`} className="border-t border-grid">
                  <td className="px-3 py-2"><input name="codes" defaultValue={t?.codes ?? ''} placeholder="07, 08, 23 below 30000" className={input} aria-label={`Row ${i + 1} counters`} /></td>
                  <td className="px-3 py-2"><input name="assistants" defaultValue={t?.assistants ?? ''} placeholder="Pavithra, Yuvaraj" list="hr-employee-names" className={input} aria-label={`Row ${i + 1} sales assistants`} /></td>
                  <td className="px-3 py-2"><input name="target_1" type="number" min={0} defaultValue={t?.target1 ?? ''} className={`${input} text-right`} aria-label={`Row ${i + 1} target 1`} /></td>
                  <td className="px-3 py-2"><input name="target_2" type="number" min={0} defaultValue={t?.target2 ?? ''} className={`${input} text-right`} aria-label={`Row ${i + 1} target 2`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="hr-employee-names">{employees.filter((e) => e.status === 'Active').map((e) => <option key={e.employeeCode} value={e.fullName}>{e.employeeCode}</option>)}</datalist>
        <p className="text-xs text-ink-muted">Need more rows? Save, then edit again: three empty rows are always added. Clear a row&rsquo;s counters and Target 1 to remove it.</p>
        <div className="flex gap-2">
          <button type="submit" className={primaryButton}>Save targets</button>
          <Link href={`/hr/counter-targets?month=${month}`} className={button}>Cancel</Link>
        </div>
      </form>
    </main>
  );
}
