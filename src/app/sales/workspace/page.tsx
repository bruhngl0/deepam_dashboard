import { redirect } from 'next/navigation';
import { SalespersonMarketingWorkspace } from '@/components/salesperson-marketing-workspace';
import { clearSalespersonSession, getAuthenticatedSalesperson, SALES_LOGIN_ROUTE } from '@/lib/salesperson-auth';

async function logout() {
  'use server';
  await clearSalespersonSession();
  redirect(SALES_LOGIN_ROUTE);
}

export default async function SalesWorkspacePage() {
  const salesperson = await getAuthenticatedSalesperson();
  if (!salesperson) redirect(SALES_LOGIN_ROUTE);
  return <SalespersonMarketingWorkspace salespersonName={salesperson.name} logoutAction={logout} />;
}
