import { VendorCustomerInsights } from '@/components/vendor-customer-insights';
import { requireUser } from '@/lib/auth';
import { getVendorCustomerInsights } from '@/lib/queries/vendor-workspace';
export const dynamic = 'force-dynamic';
export default async function VendorCustomerInsightsPage() { await requireUser(); return <VendorCustomerInsights rows={await getVendorCustomerInsights()} />; }
