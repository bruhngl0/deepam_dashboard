import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_PASS_PATH, siteGate, type GateConfig } from './site-gate';

const SECRET = 'x'.repeat(40);
const ORIGIN = 'https://crm.example.com';

const cfg: GateConfig = {
  appName: 'Test',
  modules: [
    { key: 'customer', label: 'Customer', password: () => 'customer-pw' },
    { key: 'marketing', label: 'Marketing', password: () => 'marketing-pw' },
  ],
  moduleFor: (pathname) => (pathname === '/api/health' ? null : 'any'),
  adminCookies: () => [{ name: 'store_manager_session', value: 'ok', path: '/store-manager', maxAge: 60 }],
};

// The same signing as Hemparshwa's lib/admin-pass.ts.
function pass(claims: Record<string, unknown>, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
const valid = (over: Record<string, unknown> = {}) =>
  pass({ sub: 'U-ADMIN', role: 'admin', aud: ORIGIN, exp: Math.floor(Date.now() / 1000) + 60, ...over });

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://10.0.0.1:3000${path}`, {
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'crm.example.com', ...(cookie ? { cookie } : {}) },
  });
const arrive = (t: string, next = '/crm') => siteGate(request(`${ADMIN_PASS_PATH}?${new URLSearchParams({ t, next })}`), cfg);

describe('admin pass', () => {
  beforeEach(() => vi.stubEnv('ADMIN_SSO_SECRET', SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it('signs the admin in to every module and the app logins, then lets them through', async () => {
    const res = (await arrive(valid()))!;
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/crm`);
    const cookies = res.headers.getSetCookie();
    expect(cookies.map((c) => c.split('=')[0])).toEqual(['gate_customer', 'gate_marketing', 'store_manager_session']);
    expect(cookies[2]).toContain('Path=/store-manager');

    const jar = cookies.map((c) => c.split(';')[0]).join('; ');
    expect(await siteGate(request('/marketing', jar), cfg)).toBeNull();
  });

  it.each([
    ['another app', () => valid({ aud: 'https://vendor.example.com' })],
    ['an expired pass', () => valid({ exp: Math.floor(Date.now() / 1000) - 1 })],
    ['a pass far in the future', () => valid({ exp: Math.floor(Date.now() / 1000) + 3600 })],
    ['a non-admin', () => valid({ role: 'marketing' })],
    ['a forged signature', () => pass({ role: 'admin', aud: ORIGIN, exp: Math.floor(Date.now() / 1000) + 60 }, 'y'.repeat(40))],
    ['garbage', () => 'not-a-pass'],
  ])('sends %s to the password form, with no cookies', async (_, make) => {
    const res = (await arrive(make()))!;
    expect(res.headers.get('location')).toBe(`${ORIGIN}/__gate?m=any&next=%2Fcrm`);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('accepts nothing when the secret is missing or short', async () => {
    vi.stubEnv('ADMIN_SSO_SECRET', '');
    expect((await arrive(valid()))!.headers.getSetCookie()).toEqual([]);
    vi.stubEnv('ADMIN_SSO_SECRET', 'short');
    expect((await arrive(pass({ role: 'admin', aud: ORIGIN, exp: Math.floor(Date.now() / 1000) + 60 }, 'short')))!.headers.getSetCookie()).toEqual([]);
  });

  it('only redirects within the app', async () => {
    expect((await arrive(valid(), '//evil.example.com'))!.headers.get('location')).toBe(`${ORIGIN}/`);
  });

  it('still asks everyone else for the password', async () => {
    const res = (await siteGate(request('/crm'), cfg))!;
    expect(res.headers.get('location')).toBe(`${ORIGIN}/__gate?m=any&next=%2Fcrm`);
  });
});
