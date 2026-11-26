import type { Desk } from './sales-pass';
import { getDriverCaller, getSalespersonByEmployeeNumber, isDriverCaller, type Salesperson } from './salespeople';
import type { SalesSession } from './sales-session';

/*
 * Who may use a CRM calling desk is decided in Hemparshwa OS → Auth Control (the "CRM calling desk" and "Drivers
 * calling desk" modules). The OS pass says which desk; while someone is signed in, the CRM asks the OS again at most
 * once a minute, so taking a desk away there ends it here within a minute. SALESPEOPLE / DRIVER_CALLERS are now only
 * the names lead and call history are kept under; someone not on them uses their OS name.
 */

export type DeskPerson = Salesperson & { driversOnly: boolean };

const slugOf = (name: string, emp: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || emp.toLowerCase();

/** The person a desk session is for, or undefined when it opens no desk. */
export function deskPerson(session: SalesSession | undefined): DeskPerson | undefined {
  if (!session) return undefined;
  const emp = session.employeeNumber.toUpperCase();
  if (!session.desk) {
    // A session from before Auth Control: the CRM's lists decide, as they did.
    const salesperson = getSalespersonByEmployeeNumber(emp);
    if (salesperson) return { ...salesperson, driversOnly: false };
    const caller = getDriverCaller(emp);
    return caller ? { ...caller, driversOnly: true } : undefined;
  }
  const known = getSalespersonByEmployeeNumber(emp) ?? getDriverCaller(emp);
  const name = known?.name ?? session.name ?? emp;
  return { employeeNumber: emp, name, slug: known?.slug ?? slugOf(name, emp), driversOnly: session.desk === 'drivers' };
}

/** Drivers list only: from the session's desk, or the old list for a session from before Auth Control. */
export const driversOnly = (session: SalesSession) => (session.desk ? session.desk === 'drivers' : isDriverCaller(session.employeeNumber));

type Answer = { desk: Desk | null; at: number };
const g = globalThis as unknown as { deskAccessCache?: Map<string, Answer> };
const cache = (g.deskAccessCache ??= new Map());
const MINUTE = 60_000;

/**
 * The desk Auth Control gives this employee now: "sales", "drivers", null (none), or "unknown" when the OS can't be
 * asked (not configured, or not answering). Asked at most once a minute per person.
 */
export async function currentDesk(employeeNumber: string, now = Date.now()): Promise<Desk | null | 'unknown'> {
  const emp = employeeNumber.toUpperCase();
  const hit = cache.get(emp);
  if (hit && now - hit.at < MINUTE) return hit.desk;
  const base = process.env.HEMPARSHWA_URL?.replace(/\/+$/, '');
  const token = process.env.HEMPARSHWA_INTEGRATION_TOKEN;
  if (!base || !token) return 'unknown';
  try {
    const res = await fetch(`${base}/api/integration/desk-access?emp=${encodeURIComponent(emp)}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`desk-access returned ${res.status}`);
    const body = (await res.json()) as { desk?: unknown };
    const desk = body.desk === 'sales' || body.desk === 'drivers' ? body.desk : null;
    cache.set(emp, { desk, at: now });
    return desk;
  } catch (err) {
    console.error(`desk access: could not ask Hemparshwa OS about ${emp}: ${(err as Error).message}`);
    // Keep the last answer for a while rather than asking on every click while the OS is down.
    if (hit) cache.set(emp, { ...hit, at: now - MINUTE / 2 });
    return hit?.desk ?? 'unknown';
  }
}

/**
 * Whether a desk session still stands: its desk is still given in Auth Control. A session from before Auth Control
 * (no desk on it) stands as before. When the OS can't be asked, the session stands (it was valid at sign-in, and
 * lasts at most 12 hours), so an OS outage doesn't stop the desks.
 */
export async function sessionStillValid(session: SalesSession, now = Date.now()) {
  if (!session.desk) return true;
  const desk = await currentDesk(session.employeeNumber, now);
  return desk === 'unknown' || desk === session.desk;
}

/** Tests only. */
export const clearDeskAccessCache = () => cache.clear();
