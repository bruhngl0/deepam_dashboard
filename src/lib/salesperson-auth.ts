import { cookies } from 'next/headers';

export const ABISHEK_ROUTE = '/sales/abishek';
export const ABISHEK_SESSION_COOKIE = 'sales_abishek_session';

const email = () => process.env.SALES_ABISHEK_EMAIL ?? 'abishek@deepam.local';
const password = () => process.env.SALES_ABISHEK_PASSWORD ?? 'abishek';
const token = () => process.env.SALES_ABISHEK_SESSION_TOKEN ?? 'abishek-sales-session';

export function abishekCredentials() {
  return { email: email(), password: password() };
}

export function isAbishekLogin(inputEmail: string, inputPassword: string) {
  return inputEmail.trim().toLowerCase() === email().toLowerCase() && inputPassword === password();
}

export async function isAbishekSession() {
  const cookieStore = await cookies();
  return cookieStore.get(ABISHEK_SESSION_COOKIE)?.value === token();
}

export async function setAbishekSession() {
  const cookieStore = await cookies();
  cookieStore.set(ABISHEK_SESSION_COOKIE, token(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: ABISHEK_ROUTE,
    maxAge: 60 * 60 * 12,
  });
}
