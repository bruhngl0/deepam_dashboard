/**
 * Attendance: one month, every employee by day, from attendance_days. Filled by the biometric device once it is
 * connected (source 'biometric'); until then the grid is empty.
 */

import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireUser } from '@/lib/auth';
import { listEmployees } from '@/lib/hr/employees';
import { monthRange } from '@/lib/incentives/store';
import { todayIst } from '@/lib/queries/daily';
import { formatNumber, formatPercent } from '@/lib/format';
import { button, card, control, Kpi, KpiGrid, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));
const MARK: Record<string, { short: string; tone: string }> = {
  Present: { short: 'P', tone: 'text-emerald-700 dark:text-emerald-300' },
  'Half day': { short: '½', tone: 'text-amber-700 dark:text-amber-300' },
  Absent: { short: 'A', tone: 'text-red-600 dark:text-red-300' },
  Leave: { short: 'L', tone: 'text-sky-700 dark:text-sky-300' },
  'Week off': { short: 'W', tone: 'text-ink-muted' },
  Holiday: { short: 'H', tone: 'text-ink-muted' },
};
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const thisMonth = todayIst().slice(0, 7);
  const asked = typeof sp.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : thisMonth;
  const month = asked > thisMonth ? thisMonth : asked;
  const dept = typeof sp.department === 'string' ? sp.department : '';
  const { from, to } = monthRange(month);
  const days = Array.from({ length: Number(to.slice(8)) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);

  const [all, marks] = await Promise.all([
    listEmployees(),
    db.execute(sql`SELECT employee_code, to_char(day, 'YYYY-MM-DD') AS day, status, source FROM attendance_days WHERE day BETWEEN ${from} AND ${to}`),
  ]);
  const byKey = new Map(rowsOf<{ employee_code: string; day: string; status: string; source: string }>(marks).map((r) => [`${r.employee_code}|${r.day}`, r]));
  const departments = [...new Set(all.map((e) => e.department).filter((d): d is string => !!d))].sort();
  const marked = new Set([...byKey.values()].map((r) => r.employee_code));
  const people = all.filter((e) => (e.status === 'Active' || e.status === 'On leave' || marked.has(e.employeeCode)) && (!dept || e.department === dept));
  const counted = [...byKey.values()].filter((r) => r.status !== 'Week off' && r.status !== 'Holiday');
  const present = counted.reduce((s, r) => s + (r.status === 'Present' ? 1 : r.status === 'Half day' ? 0.5 : 0), 0);
  const count = (status: string) => [...byKey.values()].filter((r) => r.status === status).length;
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <main className="mx-auto w-full max-w-[110rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Attendance"
        description="Each employee's day: present, absent, half day, leave, week off or holiday. Filled from the biometric device once it is connected."
        meta={monthLabel}
        actions={<>
          <Link href={`/hr/attendance?month=${shift(month, -1)}${dept ? `&department=${encodeURIComponent(dept)}` : ''}`} className={button}>← Previous</Link>
          {month < thisMonth && <Link href={`/hr/attendance?month=${shift(month, 1)}${dept ? `&department=${encodeURIComponent(dept)}` : ''}`} className={button}>Next →</Link>}
        </>}
      />

      {!byKey.size && (
        <p className={`${card} border-dashed p-4 text-sm text-ink-2`}>
          <b className="text-ink">Biometric not connected yet.</b> Once the device&rsquo;s punches are linked, each employee&rsquo;s in and out times land here
          by Employee ID, and the attendance figure on the overview fills in.
        </p>
      )}

      <KpiGrid columns={5}>
        <Kpi label="Attendance" value={counted.length ? formatPercent(present, counted.length) : '—'} caption="Days present ÷ working days" />
        <Kpi label="Present days" value={byKey.size ? formatNumber(count('Present') + count('Half day') / 2) : '—'} />
        <Kpi label="Absent days" value={byKey.size ? formatNumber(count('Absent')) : '—'} />
        <Kpi label="Leave days" value={byKey.size ? formatNumber(count('Leave')) : '—'} />
        <Kpi label="Half days" value={byKey.size ? formatNumber(count('Half day')) : '—'} />
      </KpiGrid>

      <form className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="month" value={month} />
        <select name="department" defaultValue={dept} className={control} aria-label="Department">
          <option value="">Every department</option>
          {departments.map((d) => <option key={d}>{d}</option>)}
        </select>
        <button type="submit" className={button}>Show</button>
        <span className="text-xs text-ink-muted">{Object.entries(MARK).map(([k, v]) => `${v.short} ${k}`).join(' · ')}</span>
      </form>

      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead><tr className="text-ink-muted">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-bold">Employee</th>
              {days.map((d) => {
                const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                return <th key={d} scope="col" className={`tnum w-7 px-0.5 py-2 text-center font-semibold ${wd === 0 ? 'bg-inset/60' : ''}`}>{Number(d.slice(8))}</th>;
              })}
              <th scope="col" className="px-3 py-2 text-right font-bold">Present</th>
            </tr></thead>
            <tbody>
              {people.map((e) => {
                let p = 0;
                return (
                  <tr key={e.employeeCode} className="border-t border-grid hover:bg-inset/50">
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5 text-left font-medium text-ink">
                      <Link href={`/hr/employees/${e.employeeCode}`} className="hover:text-accent hover:underline">{e.fullName}</Link>
                      <span className="ml-1 font-normal text-ink-muted">{e.employeeCode}</span>
                    </th>
                    {days.map((d) => {
                      const r = byKey.get(`${e.employeeCode}|${d}`);
                      if (r?.status === 'Present') p += 1; else if (r?.status === 'Half day') p += 0.5;
                      const m = r ? MARK[r.status] : null;
                      return <td key={d} title={r ? `${r.status} (${r.source})` : undefined} className={`w-7 px-0.5 py-1.5 text-center font-semibold ${m?.tone ?? 'text-line'} ${new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? 'bg-inset/60' : ''}`}>{m?.short ?? '·'}</td>;
                    })}
                    <td className="tnum px-3 py-1.5 text-right text-ink-2">{byKey.size ? formatNumber(p) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
