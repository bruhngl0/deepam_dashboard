import { VendorPurchaseRegister } from '@/components/vendor-purchase-register';
import { requireUser } from '@/lib/auth';
import { getVendorPurchaseRegister } from '@/lib/queries/vendor-workspace';

export const dynamic = 'force-dynamic';

export default async function VendorPurchasesPage() {
  await requireUser();
  return <VendorPurchaseRegister rows={await getVendorPurchaseRegister()} />;
}
