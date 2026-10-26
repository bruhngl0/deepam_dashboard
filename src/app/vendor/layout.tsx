/**
 * Vendor module shell: the same date + store filter as `/crm/*` (MasterFilterBar), above every `/vendor/*` page.
 * Each page reads `from`/`to`/`store` from its own searchParams (vendorScope in lib/queries/vendor-workspace.ts).
 */

import { getFilterOptions } from '@/lib/queries/customers';
import { MasterFilterBar } from '@/components/master-filter-bar';
import { requireUser } from '@/lib/auth';

const NOTES: Record<string, string> = {
  '/vendor/vendors': 'Dates and store narrow purchases (by purchase date and the store items went to); dates narrow payments. Stock and sales come from the latest stock report.',
  '/vendor/performance': 'Dates and store narrow purchases and returns; dates narrow payments. Stock and sales come from the latest stock report.',
  '/vendor/purchases': 'By purchase date, and the store each item went to.',
  '/vendor/customer-insights': 'By the date the customer asked. Requests are not recorded per store.',
  '/vendor/demand': 'By the date customers asked. Requests are not recorded per store.',
};

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const options = await getFilterOptions();
  return (
    <>
      <MasterFilterBar stores={options.stores} dateBounds={{ earliest: null, latest: null }} notes={NOTES} />
      {children}
    </>
  );
}
