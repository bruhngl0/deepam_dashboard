import { cookies } from 'next/headers';
import { deskPerson, type DeskPerson } from './desk-access';
import type { Desk } from './sales-pass';
import { SALES_SESSION_COOKIE, salesSessionToken, verifySalesSession } from './sales-session';
import type { Salesperson } from './salespeople';

export const SALES_LOGIN_ROUTE = '/sales';
/** Everyone signs in at Hemparshwa OS; a salesperson arrives from there at /sales/sso, signed in to their desk. */
export const HEMPARSHWA_OS_URL = 'https://os.hemparshwa.com/';
export const SALES_WORKSPACE_ROUTE = '/sales/workspace';

// Path "/" so the workspace's calls to /api/marketing/* carry the session too.
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/** A salesperson signed in to their calling desk (not a drivers-only caller). The proxy has checked the desk still stands. */
export async function getAuthenticatedSalesperson(): Promise<Salesperson | undefined> {
  const person = await getDeskCaller();
  if (!person || person.driversOnly) return undefined;
  return { employeeNumber: person.employeeNumber, name: person.name, slug: person.slug };
}

/** Anyone signed in to a calling desk: a salesperson, or a driver caller (driversOnly: the Drivers list and nothing else). */
export async function getDeskCaller(): Promise<DeskPerson | undefined> {
  return deskPerson(await verifySalesSession((await cookies()).get(SALES_SESSION_COOKIE)?.value));
}

/** Signs someone in to a desk. desk and name come from the Hemparshwa OS pass (Auth Control). */
export async function setSalespersonSession(person: Salesperson, desk?: Desk, name?: string) {
  (await cookies()).set(SALES_SESSION_COOKIE, await salesSessionToken(person.employeeNumber, desk, name), {
    ...cookieOptions,
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSalespersonSession() {
  (await cookies()).set(SALES_SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0 });
}
