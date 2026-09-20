import { VendorPerformanceTable } from '@/components/vendor-performance-table';
import { requireUser } from '@/lib/auth';
import { getVendorWorkspaceRows } from '@/lib/queries/vendor-workspace';
export const dynamic = 'force-dynamic';
export default async function VendorPerformancePage() { await requireUser(); return <VendorPerformanceTable rows={await getVendorWorkspaceRows()} />; }
