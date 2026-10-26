import { VendorMasterDirectory } from '@/components/vendor-master-directory';
import { requireUser } from '@/lib/auth';
import { getVendorWorkspaceRows, vendorScope } from '@/lib/queries/vendor-workspace';

export const dynamic = 'force-dynamic';

export default async function VendorMasterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  return <VendorMasterDirectory vendors={await getVendorWorkspaceRows(vendorScope(await searchParams))} />;
}
