import { CustomerDemand } from '@/components/vendor-workspace';
import { requireUser } from '@/lib/auth';
import { getVendorDemandRows, vendorScope } from '@/lib/queries/vendor-workspace';

export const dynamic = 'force-dynamic';

export default async function VendorDemandPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  return <CustomerDemand demand={await getVendorDemandRows(vendorScope(await searchParams))} />;
}
