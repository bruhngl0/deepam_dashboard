import { cookies } from 'next/headers';

export const STORE_MANAGER_LOGIN_ROUTE = '/store-manager';
export const STORE_MANAGER_WORKSPACE_ROUTE = '/store-manager/workspace';
const STORE_MANAGER_COOKIE = 'store_manager_session';
const STORE_MANAGER_TOKEN = 'neena-store-manager-session';

export function isStoreManagerLogin(username: string, password: string) {
  return username.trim().toLowerCase() === 'neena' && password === 'neena';
}

export async function isStoreManagerSession() {
  return (await cookies()).get(STORE_MANAGER_COOKIE)?.value === STORE_MANAGER_TOKEN;
}

export async function setStoreManagerSession() {
  (await cookies()).set(STORE_MANAGER_COOKIE, STORE_MANAGER_TOKEN, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: STORE_MANAGER_LOGIN_ROUTE,
    maxAge: 60 * 60 * 12,
  });
}

export async function clearStoreManagerSession() {
  (await cookies()).set(STORE_MANAGER_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: STORE_MANAGER_LOGIN_ROUTE,
    maxAge: 0,
  });
}
