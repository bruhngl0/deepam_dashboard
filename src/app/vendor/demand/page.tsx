import { CustomerDemand } from '@/components/vendor-workspace';
import { requireUser } from '@/lib/auth';
import { getVendorDemandRows } from '@/lib/queries/vendor-workspace';

export const dynamic = 'force-dynamic';

export default async function VendorDemandPage() {
  await requireUser();
  return <CustomerDemand demand={await getVendorDemandRows()} />;
}
