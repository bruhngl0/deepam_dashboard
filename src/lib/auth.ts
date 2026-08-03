/**
 * The authorisation boundary.
 *
 * `proxy.ts` redirects signed-out visitors, but Next.js is explicit that the
 * proxy layer is an optimistic check and not a session-management or
 * authorisation solution. This is the check that actually counts: it runs
 * server-side, inside the page, on the same request that reads the database.
 *
 * Call it at the top of every page that renders customer data — before any
 * query runs, so an unauthenticated request cannot reach the database even if
 * the proxy matcher is later edited badly.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export async function requireUser(): Promise<string> {
  // `auth()` is async in Clerk Core 3 — awaiting it is not optional.
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  return userId;
}

/**
 * The Route Handler equivalent of `requireUser`. A `redirect()` mid-fetch
 * would just hand a `fetch()` caller a followed 200 for an HTML sign-in page
 * instead of a status it can branch on — an API route needs a real 401.
 * Returns the user id on success, or a `Response` the caller should return
 * directly:
 *
 *   const auth = await requireApiUser();
 *   if (auth instanceof Response) return auth;
 */
export async function requireApiUser(): Promise<string | Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Sign in required.' }, { status: 401 });
  return userId;
}
