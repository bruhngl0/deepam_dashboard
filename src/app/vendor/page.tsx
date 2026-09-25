/** Entry point for the separately deployed vendor application. */

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function VendorPage() {
  await requireUser();
  redirect('https://n7v6pm6bm2.ap-south-1.awsapprunner.com');
}
