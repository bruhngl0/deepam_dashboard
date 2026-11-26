import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * Hemparshwa OS is the one sign-in. When a salesperson signs in there, OS sends them to /sales/sso with a pass:
 * `<base64url JSON>.<base64url HMAC-SHA256 of the first part>` under ADMIN_SSO_SECRET (shared with OS, as for the
 * admin pass), with role "sales", their employee number, this app's origin and a one-minute expiry. An admin pass
 * (role "admin") is never accepted here, and a sales pass is never accepted as an admin one.
 */
export type SalesPassClaims = { sub: string; desk: Desk | null; name: string | null };
export type Desk = 'sales' | 'drivers';

/** The employee number on a valid pass (see readSalesPassClaims). */
export function readSalesPass(pass: string | null | undefined, origin: string, now = Date.now()): string | null {
  return readSalesPassClaims(pass, origin, now)?.sub ?? null;
}

/**
 * A valid pass's claims. Since Auth Control the OS also says which desk (sales, or drivers only) and the person's
 * name; an older pass has neither, and the CRM's own lists decide as before.
 */
export function readSalesPassClaims(pass: string | null | undefined, origin: string, now = Date.now()): SalesPassClaims | null {
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
    if (typeof claims.sub !== 'string') return null;
    const desk = claims.desk === 'sales' || claims.desk === 'drivers' ? claims.desk : null;
    const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 80) : null;
    return { sub: claims.sub, desk, name };
  } catch {
    return null;
  }
}
