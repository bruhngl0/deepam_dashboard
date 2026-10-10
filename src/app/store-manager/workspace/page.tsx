import { redirect } from 'next/navigation';
import { StoreManagerWorkspace } from '@/components/store-manager-workspace';
import { clearStoreManagerSession, isStoreManagerSession, STORE_MANAGER_LOGIN_ROUTE } from '@/lib/store-manager-auth';

async function logout() {
  'use server';
  await clearStoreManagerSession();
  redirect(STORE_MANAGER_LOGIN_ROUTE);
}

export default async function StoreManagerWorkspacePage() {
  if (!await isStoreManagerSession()) redirect(STORE_MANAGER_LOGIN_ROUTE);
  return <StoreManagerWorkspace logoutAction={logout} />;
}
