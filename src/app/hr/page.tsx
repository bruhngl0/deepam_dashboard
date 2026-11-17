/**
 * HR Intelligence overview: head count, payroll, attendance, sales per employee, leave, incentives payable and
 * joiners/exits for this month, then head count by department and which HR records are still empty.
 */

import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireUser } from '@/lib/auth';
import { aq } from '@/lib/analytics/db';
import { listEmployees, type Employee } from '@/lib/hr/employees';
import { monthIncentives } from '@/lib/incentives/store';
import { monthToDate, pickRange, pickStores, rangeLabel } from '@/lib/module-filters';
import { storeMatches } from '@/lib/store-filter';
import { todayIst } from '@/lib/queries/daily';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '@/lib/format';
import { card, eyebrow, Kpi, KpiGrid, PageHeader, SectionLabel } from '@/components/ui';

export const dynamic = 'force-dynamic';

const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));
const onPayroll = (e: Employee) => e.status === 'Active' || e.status === 'On leave';

/** Records HR keeps for everyone, and how to tell one is filled in. */
const RECORDS: [string, (e: Employee) => unknown][] = [
  ['Date of birth', (e) => e.dateOfBirth], ['Contact No.', (e) => e.contactNo], ['Store', (e) => e.storeCode], ['Joining date', (e) => e.joiningDate],
  ['Employment type', (e) => e.employmentType], ['Reporting manager', (e) => e.reportingManager], ['Monthly CTC', (e) => e.monthlyCtc],
  ['Bank details', (e) => e.bankAccountNo && e.bankIfsc], ['ID proof', (e) => e.idProofNumber], ['Emergency number', (e) => e.emergencyContactNo],
  ['Blood group', (e) => e.bloodGroup],
];

async function attendanceBetween(from: string, to: string, codes: string[]) {
  if (!codes.length) return { present: 0, counted: 0 };
  const r = rowsOf<{ present: string | null; counted: string }>(await db.execute(sql`
    SELECT sum(CASE status WHEN 'Present' THEN 1 WHEN 'Half day' THEN 0.5 ELSE 0 END) AS present,
           count(*) FILTER (WHERE status NOT IN ('Week off', 'Holiday')) AS counted
    FROM attendance_days WHERE day BETWEEN ${from} AND ${to} AND employee_code = ANY(string_to_array(${codes.join(',')}, ','))`))[0];
  return { present: Number(r?.present ?? 0), counted: Number(r?.counted ?? 0) };
}

export default async function HrOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const range = pickRange(sp, monthToDate());
  const from = range.from!, today = range.to ?? todayIst();
  const stores = pickStores(sp);
  const dept = typeof sp.department === 'string' ? sp.department : '';
  const month = today.slice(0, 7);
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const periodLabel = rangeLabel(from, today);

  const employees = (await listEmployees()).filter((e) => storeMatches(stores, e.storeCode) && (!dept || e.department === dept));
  const [attendance, sales, incentives, storeCodes] = await Promise.all([
    attendanceBetween(from, today, employees.map((e) => e.employeeCode)),
    aq<{ net: string | null }>(`SELECT sum(amount) AS net FROM analytics.fact_bill b WHERE day BETWEEN $1 AND $2
      AND ($3::text IS NULL OR b.store_code IN (SELECT store_code FROM analytics.dim_store WHERE crm_code = ANY(string_to_array($3, ','))))`, [from, today, stores]),
    monthIncentives(month).catch(() => null),
    db.execute(sql`SELECT code, store_code FROM stores`).then((r) => new Map(rowsOf<{ code: string; store_code: string | null }>(r).map((x) => [x.store_code, x.code]))),
  ]);

  const payroll = employees.filter(onPayroll);
  const withCtc = payroll.filter((e) => e.monthlyCtc !== null);
  const ctc = withCtc.reduce((s, e) => s + (e.monthlyCtc ?? 0), 0);
  const onLeave = employees.filter((e) => e.status === 'On leave');
  const joined = employees.filter((e) => e.joiningDate && e.joiningDate >= from && e.joiningDate <= today);
  const exited = employees.filter((e) => e.exitDate && e.exitDate >= from && e.exitDate <= today);
  const netSales = sales ? Number(sales[0]?.net ?? 0) : null;
  const salesStaff = payroll.filter((e) => e.department === 'Sales').length;
  const incentiveTotal = incentives?.filter((r) => storeMatches(stores, storeCodes.get(r.store))).reduce((s, r) => s + r.total, 0) ?? null;

  const departments = [...new Set(employees.map((e) => e.department ?? 'No department'))].sort().map((d) => {
    const list = employees.filter((e) => (e.department ?? 'No department') === d);
    const paid = list.filter(onPayroll);
    return { name: d, total: list.length, active: list.filter((e) => e.status === 'Active').length, leave: list.filter((e) => e.status === 'On leave').length,
      ctc: paid.reduce((s, e) => s + (e.monthlyCtc ?? 0), 0), ctcKnown: paid.filter((e) => e.monthlyCtc !== null).length, paid: paid.length };
  });

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="HR Intelligence" description="People, payroll, attendance, performance and incentives in one place." meta={`${periodLabel}${stores || dept ? ' · filtered' : ''}`} />

      <KpiGrid>
        <Kpi label="Total employees" value={formatNumber(payroll.length)} href="/hr/employees"
          caption={`${formatNumber(employees.filter((e) => e.status === 'Active').length)} active · ${formatNumber(employees.length - payroll.length)} resigned or exited`} />
        <Kpi label="Monthly payroll" value={withCtc.length ? formatCurrencyCompact(ctc) : '—'}
          caption={withCtc.length === payroll.length ? 'Monthly CTC of everyone on the payroll' : `CTC entered for ${formatNumber(withCtc.length)} of ${formatNumber(payroll.length)}`} />
        <Kpi label="Attendance" value={attendance.counted ? formatPercent(attendance.present, attendance.counted) : '—'} href="/hr/attendance"
          caption={attendance.counted ? `${formatNumber(attendance.present)} of ${formatNumber(attendance.counted)} working days` : 'No attendance yet: biometric not connected'} />
        <Kpi label="Sales per employee" value={netSales !== null && payroll.length ? formatCurrencyCompact(netSales / payroll.length) : '—'} href="/hr/performance"
          caption={netSales !== null ? `${formatCurrencyCompact(netSales)} net sales ÷ ${formatNumber(payroll.length)} employees${salesStaff ? ` · ${formatCurrencyCompact(netSales / salesStaff)} per sales staff` : ''}` : 'Sales data not connected here'} />
        <Kpi label="Employees on leave" value={formatNumber(onLeave.length)} href="/hr/employees?status=On+leave"
          caption={onLeave.length ? onLeave.slice(0, 3).map((e) => e.fullName).join(', ') + (onLeave.length > 3 ? '…' : '') : 'Nobody marked on leave'} />
        <Kpi label={`Incentives payable · ${monthLabel}`} value={incentiveTotal !== null ? formatCurrency(incentiveTotal) : '—'} href="/hr/incentives"
          caption={incentiveTotal !== null ? 'For the month the period ends in, by the circulars' : 'Sales data not connected here'} />
        <Kpi label="New employees" value={formatNumber(joined.length)} caption={joined.length ? joined.map((e) => e.fullName).join(', ') : `Joining dates ${periodLabel}`} />
        <Kpi label="Exits" value={formatNumber(exited.length)} caption={exited.length ? exited.map((e) => e.fullName).join(', ') : `Exit dates ${periodLabel}`} />
      </KpiGrid>

      <SectionLabel>By department</SectionLabel>
      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '40rem' }}>
            <thead><tr className={eyebrow}>{['Department', 'Employees', 'Active', 'On leave', 'Monthly payroll'].map((h, i) =>
              <th key={h} scope="col" className={`px-4 py-3 font-bold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.name} className="border-t border-grid hover:bg-inset/50">
                  <th scope="row" className="px-4 py-2 text-left font-medium text-ink"><Link href={`/hr/employees?department=${encodeURIComponent(d.name)}${stores ? `&store=${stores}` : ''}`} className="hover:text-accent hover:underline">{d.name}</Link></th>
                  <td className="tnum px-4 py-2 text-right text-ink">{formatNumber(d.total)}</td>
                  <td className="tnum px-4 py-2 text-right text-ink-2">{formatNumber(d.active)}</td>
                  <td className="tnum px-4 py-2 text-right text-ink-2">{d.leave ? formatNumber(d.leave) : '—'}</td>
                  <td className="tnum px-4 py-2 text-right text-ink-2">{d.ctcKnown ? <>{formatCurrency(d.ctc)}{d.ctcKnown < d.paid && <span className="block text-xs text-ink-muted">{d.ctcKnown} of {d.paid} entered</span>}</> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SectionLabel>Records to fill in</SectionLabel>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {RECORDS.map(([label, has]) => {
          const filled = payroll.filter((e) => has(e)).length;
          return (
            <div key={label} className={`${card} px-4 py-3`}>
              <p className={eyebrow}>{label}</p>
              <p className="tnum mt-1 text-sm text-ink"><b>{formatNumber(filled)}</b> of {formatNumber(payroll.length)} filled</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-inset"><div className="h-full rounded-full bg-accent" style={{ width: `${payroll.length ? (100 * filled) / payroll.length : 0}%` }} /></div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
