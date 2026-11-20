import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * Hemparshwa OS is the one sign-in. When a salesperson signs in there, OS sends them to /sales/sso with a pass:
 * `<base64url JSON>.<base64url HMAC-SHA256 of the first part>` under ADMIN_SSO_SECRET (shared with OS, as for the
 * admin pass), with role "sales", their employee number, this app's origin and a one-minute expiry. An admin pass
 * (role "admin") is never accepted here, and a sales pass is never accepted as an admin one.
 */
export function readSalesPass(pass: string | null | undefined, origin: string, now = Date.now()): string | null {
  const secret = process.env.ADMIN_SSO_SECRET;
  if (!secret || secret.length < 32 || !pass) return null;
  const [body, signature] = pass.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const exp = Number(claims.exp) * 1000;
    if (claims.role !== 'sales' || claims.aud !== origin || !(exp > now) || exp > now + 5 * 60_000) return null;
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}
