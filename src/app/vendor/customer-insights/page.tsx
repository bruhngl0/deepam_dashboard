import { VendorCustomerInsights } from '@/components/vendor-customer-insights';
import { requireUser } from '@/lib/auth';
import { getVendorCustomerInsights, vendorScope } from '@/lib/queries/vendor-workspace';
export const dynamic = 'force-dynamic';
export default async function VendorCustomerInsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { await requireUser(); return <VendorCustomerInsights rows={await getVendorCustomerInsights(vendorScope(await searchParams))} />; }
