import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { ADMIN_PASS_PATH, GO_PATH, siteGate, type GateConfig } from './site-gate';

const SECRET = 'test-admin-sso-secret-0123456789abcdef';
const ORIGIN = 'https://crm.example';
const PEER = 'https://vendor.example';

const cfg: GateConfig = {
  appName: 'Test',
  modules: [{ key: 'overview', label: 'Overview', password: () => 'open-sesame' }],
  moduleFor: (path) => (path.startsWith('/api/health') ? null : 'any'),
  adminCookies: () => [{ name: 'app_staff', value: 'staff-token', maxAge: 3600 }],
  peers: [PEER],
};

/** A pass in Hemparshwa's format: base64url JSON + HMAC-SHA256 under the shared secret. */
function pass(claims: Record<string, unknown>, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
const now = () => Math.floor(Date.now() / 1000);
const request = (path: string, cookies: Record<string, string> = {}, method = 'GET') =>
  new NextRequest(`${ORIGIN}${path}`, { method, headers: { host: 'crm.example', 'x-forwarded-proto': 'https', cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
const cookiesOf = (res: Response) => Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(';')[0].split(/=(.*)/s).slice(0, 2)));

describe('site gate: admin session', () => {
  beforeEach(() => {
    process.env.ADMIN_SSO_SECRET = SECRET;
  });

  it('turns a Hemparshwa pass into the module cookie, the app login and a 30-day admin session', async () => {
    const t = pass({ sub: 7, name: 'Admin', role: 'admin', aud: ORIGIN, exp: now() + 60 });
    const res = (await siteGate(request(`${ADMIN_PASS_PATH}?t=${t}&next=/crm`), cfg))!;
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/crm`);
    const set = cookiesOf(res);
    expect(Object.keys(set)).toEqual(expect.arrayContaining(['gate_overview', 'app_staff', 'gate_admin', 'gate_admin_fresh']));
    expect(res.headers.getSetCookie().find((c) => c.startsWith('gate_admin='))).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
  });

  it('refuses a pass for another app, an expired one and a forged one', async () => {
    for (const t of [
      pass({ sub: 7, name: 'Admin', role: 'admin', aud: PEER, exp: now() + 60 }),
      pass({ sub: 7, name: 'Admin', role: 'admin', aud: ORIGIN, exp: now() - 1 }),
      pass({ sub: 7, name: 'Admin', role: 'admin', aud: ORIGIN, exp: now() + 60 }, 'some-other-secret-0123456789abcdefgh'),
    ]) {
      const res = (await siteGate(request(`${ADMIN_PASS_PATH}?t=${t}`), cfg))!;
      expect(res.headers.get('location')).toContain('/__gate?');
      expect(cookiesOf(res).gate_admin).toBeUndefined();
    }
  });

  it('renews every login once the hourly marker has lapsed, so the 12-hour cookies never run out on an admin', async () => {
    const session = pass({ sub: 7, name: 'Admin', role: 'admin', exp: now() + 3600 });
    const res = (await siteGate(request('/crm/buyers?x=1', { gate_admin: session }), cfg))!;
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/crm/buyers?x=1`);
    expect(Object.keys(cookiesOf(res))).toEqual(expect.arrayContaining(['gate_overview', 'app_staff', 'gate_admin', 'gate_admin_fresh']));
  });

  it('lets a renewed admin straight through, pages and APIs alike, with no password cookie', async () => {
    const session = pass({ sub: 7, name: 'Admin', role: 'admin', exp: now() + 3600 });
    expect(await siteGate(request('/crm', { gate_admin: session, gate_admin_fresh: '1' }), cfg)).toBeNull();
    expect(await siteGate(request('/api/customers/export', { gate_admin: session }, 'POST'), cfg)).toBeNull();
  });

  it('sends everyone else to the password form as before, including with a forged or expired admin cookie', async () => {
    for (const cookies of [{}, { gate_admin: 'nonsense.value' }, { gate_admin: pass({ sub: 7, name: 'A', role: 'admin', exp: now() - 5 }) }]) {
      const res = (await siteGate(request('/crm', cookies), cfg))!;
      expect(res.headers.get('location')).toContain('/__gate?');
    }
  });
});

describe('site gate: opening another Deepam app', () => {
  beforeEach(() => {
    process.env.ADMIN_SSO_SECRET = SECRET;
  });

  it('gives a signed-in admin a one-minute pass for that app only', async () => {
    const session = pass({ sub: 7, name: 'Admin', role: 'admin', exp: now() + 3600 });
    const res = (await siteGate(request(`${GO_PATH}?to=${encodeURIComponent(`${PEER}/products?x=1`)}`, { gate_admin: session }), cfg))!;
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${PEER}${ADMIN_PASS_PATH}`);
    expect(location.searchParams.get('next')).toBe('/products?x=1');
    const [body, signature] = location.searchParams.get('t')!.split('.');
    expect(createHmac('sha256', SECRET).update(body).digest('base64url')).toBe(signature);
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    expect(claims).toMatchObject({ role: 'admin', aud: PEER, sub: '7' });
    expect(claims.exp - now()).toBeLessThanOrEqual(60);
  });

  it('sends anyone else to the app as is, and refuses apps that are not peers', async () => {
    const plain = (await siteGate(request(`${GO_PATH}?to=${encodeURIComponent(`${PEER}/`)}`), cfg))!;
    expect(plain.headers.get('location')).toBe(`${PEER}/`);
    const other = (await siteGate(request(`${GO_PATH}?to=${encodeURIComponent('https://evil.example/')}`), cfg))!;
    expect(other.status).toBe(400);
  });
});
