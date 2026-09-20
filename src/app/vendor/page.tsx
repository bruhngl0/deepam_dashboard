/** Vendor dashboard. Demo data stays UI-only until the workbook is mapped. */

import { VendorDashboard } from '@/components/vendor-workspace';
import { requireUser } from '@/lib/auth';
import { getRecentVendorPurchaseOrders, getVendorDemandRows, getVendorWorkspaceRows } from '@/lib/queries/vendor-workspace';

export const dynamic = 'force-dynamic';

export default async function VendorPage() {
  await requireUser();
  const [vendors, demand, purchaseOrders] = await Promise.all([getVendorWorkspaceRows(), getVendorDemandRows(), getRecentVendorPurchaseOrders()]);
  return <VendorDashboard vendors={vendors} demand={demand} purchaseOrders={purchaseOrders} />;
}
