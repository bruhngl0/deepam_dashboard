import { cookies } from 'next/headers';
import { getSalespersonByEmployeeNumber, type Salesperson } from './salespeople';

export const SALES_LOGIN_ROUTE = '/sales';
export const SALES_WORKSPACE_ROUTE = '/sales/workspace';
const SALES_SESSION_COOKIE = 'salesperson_session';
const tokenFor = (salesperson: Salesperson) => `${salesperson.employeeNumber.toLowerCase()}-sales-session`;

export async function getAuthenticatedSalesperson() {
  const cookieStore = await cookies();
  const value = cookieStore.get(SALES_SESSION_COOKIE)?.value;
  if (!value) return undefined;
  const salesperson = getSalespersonByEmployeeNumber(value.split('-sales-session')[0]);
  return salesperson && value === tokenFor(salesperson) ? salesperson : undefined;
}

export async function setSalespersonSession(salesperson: Salesperson) {
  const cookieStore = await cookies();
  cookieStore.set(SALES_SESSION_COOKIE, tokenFor(salesperson), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: SALES_LOGIN_ROUTE,
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSalespersonSession() {
  const cookieStore = await cookies();
  cookieStore.set(SALES_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: SALES_LOGIN_ROUTE,
    maxAge: 0,
  });
}
