import { cookies } from 'next/headers';
import { getSalespersonByEmployeeNumber, type Salesperson } from './salespeople';
import { SALES_SESSION_COOKIE, salesSessionToken, verifySalesSessionToken } from './sales-session';

export const SALES_LOGIN_ROUTE = '/sales';
export const SALES_WORKSPACE_ROUTE = '/sales/workspace';

// Path "/" so the workspace's calls to /api/marketing/* carry the session too.
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function getAuthenticatedSalesperson() {
  const employeeNumber = await verifySalesSessionToken((await cookies()).get(SALES_SESSION_COOKIE)?.value);
  return employeeNumber ? getSalespersonByEmployeeNumber(employeeNumber) : undefined;
}

export async function setSalespersonSession(salesperson: Salesperson) {
  (await cookies()).set(SALES_SESSION_COOKIE, await salesSessionToken(salesperson.employeeNumber), {
    ...cookieOptions,
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSalespersonSession() {
  (await cookies()).set(SALES_SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0 });
}
