import { cookies } from 'next/headers';
import { getDriverCaller, getSalespersonByEmployeeNumber, type Salesperson } from './salespeople';
import { SALES_SESSION_COOKIE, salesSessionToken, verifySalesSessionToken } from './sales-session';

export const SALES_LOGIN_ROUTE = '/sales';
/** Everyone signs in at Hemparshwa OS; a salesperson arrives from there at /sales/sso, signed in to their desk. */
export const HEMPARSHWA_OS_URL = 'https://nvc57svvmb.ap-south-1.awsapprunner.com/';
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

/** Anyone signed in to a calling desk: a salesperson, or a driver caller (driversOnly: the Drivers list and nothing else). */
export async function getDeskCaller(): Promise<(Salesperson & { driversOnly: boolean }) | undefined> {
  const employeeNumber = await verifySalesSessionToken((await cookies()).get(SALES_SESSION_COOKIE)?.value);
  if (!employeeNumber) return undefined;
  const salesperson = getSalespersonByEmployeeNumber(employeeNumber);
  if (salesperson) return { ...salesperson, driversOnly: false };
  const caller = getDriverCaller(employeeNumber);
  return caller ? { ...caller, driversOnly: true } : undefined;
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
