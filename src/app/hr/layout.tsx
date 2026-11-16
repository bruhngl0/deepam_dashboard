/**
 * HR Intelligence module shell: Overview, Employees, Performance (with the Salespeople pages), Attendance and Incentives.
 * The master date+store filter sits above the Salespeople pages only, which read `from`/`to`/`store`; the others pick a month.
 */

import { getSalesDateBounds } from '@/lib/queries/dashboard';
import { getFilterOptions } from '@/lib/queries/customers';
import { MasterFilterBar } from '@/components/master-filter-bar';
import { requireUser } from '@/lib/auth';

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  const [dateBounds, options] = await Promise.all([getSalesDateBounds(), getFilterOptions()]);

  return (
    <>
      <MasterFilterBar stores={options.stores} dateBounds={dateBounds} onlyUnder="/hr/salespeople" />
      {children}
    </>
  );
}
