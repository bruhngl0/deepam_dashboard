import { VendorPerformanceTable } from '@/components/vendor-performance-table';
import { requireUser } from '@/lib/auth';
import { getVendorWorkspaceRows, vendorScope } from '@/lib/queries/vendor-workspace';
export const dynamic = 'force-dynamic';
export default async function VendorPerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { await requireUser(); return <VendorPerformanceTable rows={await getVendorWorkspaceRows(vendorScope(await searchParams))} />; }
