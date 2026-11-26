/**
 * The salesperson session token: the employee number plus an HMAC of it under
 * SALES_SESSION_SECRET, so it cannot be made up. Web Crypto only, because the
 * proxy reads it too (the site password gate lets a signed-in salesperson reach
 * the marketing APIs their workspace uses).
 */

export const SALES_SESSION_COOKIE = 'sales_session';

const encoder = new TextEncoder();

function secret() {
  const value = process.env.SALES_SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === 'production') return null;
  return 'local-sales-session-secret';
}

async function sign(payload: string, key: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`sales:${payload}`)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

const hex = (s: string) => Array.from(encoder.encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => new TextDecoder().decode(new Uint8Array((h.match(/../g) ?? []).map((b) => parseInt(b, 16))));

export type SalesSession = { employeeNumber: string; desk?: 'sales' | 'drivers'; name?: string };

/**
 * `<EMP>.<mac>`, or since Auth Control `<EMP>.<desk>.<name as hex>.<mac>`: the desk and name the OS pass gave,
 * signed with the employee number so neither can be changed.
 */
export async function salesSessionToken(employeeNumber: string, desk?: 'sales' | 'drivers', name?: string) {
  const key = secret();
  if (!key) throw new Error('SALES_SESSION_SECRET is not set');
  const emp = employeeNumber.toUpperCase();
  if (!desk) return `${emp}.${await sign(emp, key)}`;
  const n = hex((name ?? '').slice(0, 80));
  return `${emp}.${desk}.${n}.${await sign(`${emp}:${desk}:${n}`, key)}`;
}

function same(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The session the token was issued for, or undefined when it is missing or forged. */
export async function verifySalesSession(token: string | undefined): Promise<SalesSession | undefined> {
  const key = secret();
  if (!token || !key) return undefined;
  const parts = token.split('.');
  if (parts.length === 2) {
    const [employeeNumber, mac] = parts;
    return employeeNumber && mac && same(await sign(employeeNumber, key), mac) ? { employeeNumber } : undefined;
  }
  if (parts.length !== 4) return undefined;
  const [employeeNumber, desk, n, mac] = parts;
  if (!employeeNumber || (desk !== 'sales' && desk !== 'drivers') || !/^[0-9a-f]*$/.test(n) || !mac) return undefined;
  if (!same(await sign(`${employeeNumber}:${desk}:${n}`, key), mac)) return undefined;
  return { employeeNumber, desk, name: unhex(n) || undefined };
}

/** The employee number the token was issued to, or undefined when it is missing or forged. */
export async function verifySalesSessionToken(token: string | undefined) {
  return (await verifySalesSession(token))?.employeeNumber;
}

/** Set by the proxy (never trusted from the browser) when a request got in on a salesperson login alone: the employee number. */
export const SALES_ONLY_HEADER = 'x-deepam-sales-only';

/** Set by the proxy with SALES_ONLY_HEADER: that salesperson's name (URI-encoded), which their leads and calls are under. */
export const SALES_NAME_HEADER = 'x-deepam-sales-name';
