/**
 * Performance: the KPIs for each department (lib/hr/kpis.ts), for one month. Sales and calling KPIs are worked out
 * from the sales sheet, WalkTrack and CRM calls for employees linked to a salesperson; the rest stay empty until a
 * data source is connected.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { salespersonStats, type SalespersonStats } from '@/lib/analytics/salesperson-module';
import { listEmployees } from '@/lib/hr/employees';
import { DEPARTMENT_KPIS, kpisFor, type Kpi } from '@/lib/hr/kpis';
import { monthToDate, pickRange, pickStores, rangeLabel } from '@/lib/module-filters';
import { storeMatches } from '@/lib/store-filter';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '@/lib/format';
import { button, card, eyebrow, PageHeader, SectionLabel } from '@/components/ui';

export const dynamic = 'force-dynamic';

function liveValue(kpi: Kpi, s: SalespersonStats | undefined): string {
  if (!kpi.live || !s) return '—';
  switch (kpi.live) {
    case 'netSales': return s.bills || s.returns ? formatCurrencyCompact(s.netSales) : '—';
    case 'bills': return formatNumber(s.bills);
    case 'avgBill': return s.bills ? formatCurrency(s.grossSales / s.bills) : '—';
    case 'discount': return s.discount ? formatPercent(s.discount, s.grossSales + s.discount) : '—';
    case 'conversion': return s.walkIns ? formatPercent(s.walkInsConverted, s.walkIns, 0) : '—';
    case 'newCustomers': return formatNumber(s.newCustomers);
    case 'returns': return s.returned ? formatCurrencyCompact(s.returned) : '—';
    case 'calls': return formatNumber(s.calls);
    case 'connected': return s.calls ? `${formatNumber(s.connected)} (${formatPercent(s.connected, s.calls, 0)})` : '—';
  }
}

export default async function PerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const picked = pickRange(sp, monthToDate());
  const range = { from: picked.from! }, to = picked.to!;
  const stores = pickStores(sp);
  const dept = typeof sp.department === 'string' ? sp.department : '';
  const needle = (typeof sp.q === 'string' ? sp.q : '').trim().toUpperCase();
  // Same search as Employees: name, employee ID or designation.
  const found = (e: { fullName: string; employeeCode: string; designation?: string | null }) =>
    !needle || e.fullName.toUpperCase().includes(needle) || e.employeeCode.toUpperCase().includes(needle) || (e.designation ?? '').toUpperCase().includes(needle);
  const carry = `from=${range.from}&to=${to}${stores ? `&store=${stores}` : ''}`;

  const [employees, stats] = await Promise.all([listEmployees(), salespersonStats({ from: range.from, to, store: stores }).catch(() => null)]);
  const byKey = new Map((stats ?? []).map((s) => [s.empCode, s]));
  const onPayroll = employees.filter((e) => (e.status === 'Active' || e.status === 'On leave') && storeMatches(stores, e.storeCode) && found(e));
  const departments = [...new Set([...Object.keys(DEPARTMENT_KPIS), ...onPayroll.map((e) => e.department).filter((d): d is string => !!d)])]
    .filter((d) => !dept || d === dept)
    .sort((a, b) => (a === 'Sales' ? -1 : b === 'Sales' ? 1 : a.localeCompare(b)));

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Performance"
        description="The KPIs each department is measured on. Sales and calling figures come from the sales sheet, WalkTrack and CRM calls; the others fill in as their data is connected."
        meta={`${rangeLabel(range.from, to)}${stats === null ? ' · sales data not connected here' : ''}`}
        actions={<Link href={`/hr/salespeople?${carry}`} className={button}>Every salesperson in detail</Link>}
      />

      {needle && !onPayroll.length && <p className="py-10 text-center text-sm text-ink-muted">No employee matches “{needle.toLowerCase()}”.</p>}


      {departments.map((d) => {
        const kpis = kpisFor(d);
        const people = onPayroll.filter((e) => e.department === d);
        // While searching, only the departments with someone matching.
        if (!people.length && (needle || !kpis.length)) return null;
        return (
          <section key={d} className="space-y-3">
            <SectionLabel>{d} · {formatNumber(people.length)} {people.length === 1 ? 'employee' : 'employees'}</SectionLabel>
            <div className={`${card} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" style={{ minWidth: `${16 + kpis.length * 9}rem` }}>
                  <thead><tr className={eyebrow}>
                    <th scope="col" className="px-3 py-3 text-left font-bold">Employee</th>
                    {kpis.map((k) => <th key={k.name} scope="col" title={k.measure} className="px-3 py-3 text-right font-bold">{k.name}{!k.live && <span className="block font-normal normal-case tracking-normal text-ink-muted">no data yet</span>}</th>)}
                  </tr></thead>
                  <tbody>
                    {people.map((e) => {
                      const s = e.salespersonKey ? byKey.get(e.salespersonKey) : undefined;
                      return (
                        <tr key={e.employeeCode} className="border-t border-grid hover:bg-inset/50">
                          <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                            <Link href={e.salespersonKey ? `/hr/salespeople/${e.employeeCode}?${carry}` : `/hr/employees/${e.employeeCode}`} className="hover:text-accent hover:underline">{e.fullName}</Link>
                            <span className="block text-xs font-normal text-ink-muted">{e.employeeCode}{e.designation ? ` · ${e.designation}` : ''}</span>
                          </th>
                          {kpis.map((k) => <td key={k.name} className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{liveValue(k, s)}</td>)}
                        </tr>
                      );
                    })}
                    {!people.length && <tr><td colSpan={kpis.length + 1} className="px-3 py-6 text-center text-ink-muted">No employees in this department.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            {kpis.length > 0 && <p className="text-xs text-ink-muted">{kpis.map((k) => <span key={k.name}><b className="text-ink-2">{k.name}:</b> {k.measure}. </span>)}</p>}
          </section>
        );
      })}
    </main>
  );
}
