import { cookies } from 'next/headers';
import { STORE_MANAGER_COOKIE, STORE_MANAGER_COOKIE_PATH, STORE_MANAGER_MAX_AGE, STORE_MANAGER_TOKEN } from './store-manager-session';

export const STORE_MANAGER_LOGIN_ROUTE = STORE_MANAGER_COOKIE_PATH;
export const STORE_MANAGER_WORKSPACE_ROUTE = '/store-manager/workspace';

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
    maxAge: STORE_MANAGER_MAX_AGE,
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
