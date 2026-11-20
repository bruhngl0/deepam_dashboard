import { redirect } from 'next/navigation';
import { SalespersonMarketingWorkspace } from '@/components/salesperson-marketing-workspace';
import { clearSalespersonSession, getAuthenticatedSalesperson, HEMPARSHWA_OS_URL } from '@/lib/salesperson-auth';

async function logout() {
  'use server';
  await clearSalespersonSession();
  redirect(HEMPARSHWA_OS_URL);
}

export default async function SalesWorkspacePage() {
  const salesperson = await getAuthenticatedSalesperson();
  if (!salesperson) redirect(HEMPARSHWA_OS_URL);
  return <SalespersonMarketingWorkspace salespersonName={salesperson.name} logoutAction={logout} />;
}
