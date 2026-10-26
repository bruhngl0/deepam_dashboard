import { VendorPurchaseRegister } from '@/components/vendor-purchase-register';
import { requireUser } from '@/lib/auth';
import { getVendorPurchaseRegister, vendorScope } from '@/lib/queries/vendor-workspace';

export const dynamic = 'force-dynamic';

export default async function VendorPurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  return <VendorPurchaseRegister rows={await getVendorPurchaseRegister(vendorScope(await searchParams))} />;
}
