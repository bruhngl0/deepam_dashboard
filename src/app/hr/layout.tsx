/**
 * HR Intelligence module shell: Overview, Employees, Performance (with the Salespeople pages), Attendance, Counter targets and Incentives.
 * One filter box on the right of every list page title (components/module-filters.tsx), in the same order everywhere:
 * Department / Status and search, then Store, then From/To (Month on the monthly pages: Counter targets, Incentives).
 */

import { getSalesDateBounds } from '@/lib/queries/dashboard';
import { getFilterOptions } from '@/lib/queries/customers';
import { ModuleFilters, type FilterField, type FilterPage } from '@/components/module-filters';
import { requireUser } from '@/lib/auth';
import { listEmployees, STATUSES } from '@/lib/hr/employees';
import { todayIst } from '@/lib/queries/daily';

const MAIN_STORES = ['MG_ROAD', 'JAYANAGAR'];

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  const [dateBounds, options, employees] = await Promise.all([getSalesDateBounds(), getFilterOptions(), listEmployees().catch(() => [])]);
  const departments = [...new Set(employees.map((e) => e.department).filter((d): d is string => !!d))].sort();
  const department: FilterField = { kind: 'select', param: 'department', label: 'Department', all: 'Every department', options: departments.map((d) => ({ value: d, label: d })) };
  const mainStores = options.stores.filter((s) => MAIN_STORES.includes(s.code));

  const pages: FilterPage[] = [
    { path: '/hr', store: true, period: 'range', fields: [department], note: 'Narrows employees by store and department; attendance, sales and joiners/exits by the dates. Default: this month to date.' },
    { path: '/hr/employees', store: true, period: 'range', periodLabel: 'Joined', fields: [department,
      { kind: 'select', param: 'status', label: 'Status', all: 'Any status', options: STATUSES.map((s) => ({ value: s, label: s })) },
      { kind: 'search', param: 'q', placeholder: 'Name, ID or designation' }] },
    { path: '/hr/performance', store: true, period: 'range', fields: [department, { kind: 'search', param: 'q', placeholder: 'Name, ID or designation' }], note: 'Sales and calling KPIs for the dates and stores picked. Default: this month to date.' },
    { path: '/hr/attendance', store: true, period: 'range', fields: [department], note: 'Default: this month. Up to 62 days at a time.' },
    { path: '/hr/salespeople', prefix: true, store: true, period: 'range' },
    { path: '/hr/counter-targets', store: true, stores: mainStores, period: 'month' },
    { path: '/hr/incentives', store: true, stores: mainStores, period: 'month' },
  ];

  return (
    <>
      <ModuleFilters pages={pages} stores={options.stores} dateBounds={dateBounds} thisMonth={todayIst().slice(0, 7)} />
      {children}
    </>
  );
}
