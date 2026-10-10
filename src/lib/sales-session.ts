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

async function sign(employeeNumber: string, key: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`sales:${employeeNumber}`)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function salesSessionToken(employeeNumber: string) {
  const key = secret();
  if (!key) throw new Error('SALES_SESSION_SECRET is not set');
  return `${employeeNumber.toUpperCase()}.${await sign(employeeNumber.toUpperCase(), key)}`;
}

/** The employee number the token was issued to, or undefined when it is missing or forged. */
export async function verifySalesSessionToken(token: string | undefined) {
  const key = secret();
  if (!token || !key) return undefined;
  const [employeeNumber, mac] = token.split('.');
  if (!employeeNumber || !mac) return undefined;
  const expected = await sign(employeeNumber, key);
  let diff = expected.length ^ mac.length;
  for (let i = 0; i < expected.length && i < mac.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  return diff === 0 ? employeeNumber : undefined;
}
