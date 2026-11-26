import { redirect } from 'next/navigation';
import { DriverCallerWorkspace } from '@/components/driver-caller-workspace';
import { SalespersonMarketingWorkspace } from '@/components/salesperson-marketing-workspace';
import { clearSalespersonSession, getDeskCaller, HEMPARSHWA_OS_URL } from '@/lib/salesperson-auth';

async function logout() {
  'use server';
  await clearSalespersonSession();
  redirect(HEMPARSHWA_OS_URL);
}

export default async function SalesWorkspacePage() {
  const caller = await getDeskCaller();
  if (!caller) redirect(HEMPARSHWA_OS_URL);
  if (caller.driversOnly) return <DriverCallerWorkspace name={caller.name} logoutAction={logout} />;
  return <SalespersonMarketingWorkspace salespersonName={caller.name} logoutAction={logout} />;
}
