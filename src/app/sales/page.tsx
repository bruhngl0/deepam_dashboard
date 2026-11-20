import { redirect } from 'next/navigation';
import { getAuthenticatedSalesperson, HEMPARSHWA_OS_URL, SALES_WORKSPACE_ROUTE } from '@/lib/salesperson-auth';

// No sign-in of its own: salespeople sign in at Hemparshwa OS, which brings them to their desk (/sales/sso).
export default async function SalesLoginPage() {
  redirect((await getAuthenticatedSalesperson()) ? SALES_WORKSPACE_ROUTE : HEMPARSHWA_OS_URL);
}
