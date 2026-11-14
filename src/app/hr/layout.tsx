/**
 * HR Intelligence module shell: the salespeople and their incentives. The master date+store filter sits above the Salespeople pages, which read
 * `from`/`to`/`store`; Incentives (picked by month) does not use it, so it is hidden there.
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
