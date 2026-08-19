/**
 * CRM module shell — the master date+store filter, above every `/crm/*` page.
 *
 * A thin Server Component: it fetches only what the filter bar's controls
 * need (the store list, the loaded date bounds) and renders `MasterFilterBar`
 * above `{children}`. Each page still reads `from`/`to`/`store` from its own
 * `searchParams` and threads them into its own queries — this layout doesn't
 * own the data, just the control that sets the shared URL state.
 *
 * `requireUser()` here too, same reasoning as every page: the proxy redirect
 * is not the boundary, and this layout runs its own queries before any page
 * beneath it does.
 */

import { getSalesDateBounds } from '@/lib/queries/dashboard';
import { getFilterOptions } from '@/lib/queries/customers';
import { MasterFilterBar } from '@/components/master-filter-bar';
import { requireUser } from '@/lib/auth';

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  const [dateBounds, options] = await Promise.all([getSalesDateBounds(), getFilterOptions()]);

  return (
    <>
      <MasterFilterBar stores={options.stores} dateBounds={dateBounds} />
      {children}
    </>
  );
}
