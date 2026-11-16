/** Entry point for the separately deployed vendor application. */

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function VendorPage() {
  await requireUser();
  redirect('/__gate/go?to=https%3A%2F%2Fvendor.hemparshwa.com%2F');
}
