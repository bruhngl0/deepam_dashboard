import { VendorMasterDirectory } from '@/components/vendor-master-directory';
import { requireUser } from '@/lib/auth';
import { getVendorWorkspaceRows } from '@/lib/queries/vendor-workspace';

export const dynamic = 'force-dynamic';

export default async function VendorMasterPage() {
  await requireUser();
  return <VendorMasterDirectory vendors={await getVendorWorkspaceRows()} />;
}
