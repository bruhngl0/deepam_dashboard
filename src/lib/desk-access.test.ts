import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import proxy from '@/proxy';
import { clearDeskAccessCache, currentDesk, deskPerson } from './desk-access';
import { readSalesPassClaims } from './sales-pass';
import { SALES_SESSION_COOKIE, salesSessionToken, verifySalesSession } from './sales-session';

const ORIGIN = 'https://crm.example.com';
const mint = (claims: object) => {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${createHmac('sha256', 'x'.repeat(40)).update(body).digest('base64url')}`;
};
const soon = () => Math.floor(Date.now() / 1000) + 60;

describe('Auth Control desks (phase 3)', () => {
  const saved = { ...process.env };
  let osSays: unknown = 'sales';
  let osUp = true;
  const fetchMock = vi.fn(async () => (osUp ? Response.json({ desk: osSays }) : new Response('down', { status: 502 })));
  beforeEach(() => {
    process.env.ADMIN_SSO_SECRET = 'x'.repeat(40);
    process.env.HEMPARSHWA_URL = 'https://os.example.com';
    process.env.HEMPARSHWA_INTEGRATION_TOKEN = 'token';
    vi.stubGlobal('fetch', fetchMock);
    clearDeskAccessCache();
    fetchMock.mockClear();
    osSays = 'sales';
    osUp = true;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it('reads the desk and name on a pass; an older pass has neither', () => {
    expect(readSalesPassClaims(mint({ sub: 'DBYA0150', role: 'sales', desk: 'drivers', name: 'New Hire', aud: ORIGIN, exp: soon() }), ORIGIN))
      .toEqual({ sub: 'DBYA0150', desk: 'drivers', name: 'New Hire' });
    expect(readSalesPassClaims(mint({ sub: 'DBYA0027', role: 'sales', aud: ORIGIN, exp: soon() }), ORIGIN)).toEqual({ sub: 'DBYA0027', desk: null, name: null });
  });

  it('signs desk and name into the session so neither can be changed', async () => {
    const token = await salesSessionToken('DBYA0150', 'sales', 'New Hire');
    expect(await verifySalesSession(token)).toEqual({ employeeNumber: 'DBYA0150', desk: 'sales', name: 'New Hire' });
    const [emp, , name, mac] = token.split('.');
    expect(await verifySalesSession([emp, 'drivers', name, mac].join('.'))).toBeUndefined();
    expect(await verifySalesSession(await salesSessionToken('DBYA0012'))).toEqual({ employeeNumber: 'DBYA0012' });
  });

  it('opens a desk for someone on no CRM list, under their OS name; list names still win', () => {
    expect(deskPerson({ employeeNumber: 'DBYA0150', desk: 'sales', name: 'New Hire' })).toMatchObject({ name: 'New Hire', driversOnly: false });
    expect(deskPerson({ employeeNumber: 'DBYA0099', desk: 'drivers', name: 'RAVI' })).toMatchObject({ name: 'Ravi', driversOnly: true });
    expect(deskPerson({ employeeNumber: 'DBYA0150' })).toBeUndefined(); // no desk on the session and on no list
  });

  it('asks the OS at most once a minute', async () => {
    expect(await currentDesk('DBYA0150', 0)).toBe('sales');
    expect(await currentDesk('DBYA0150', 30_000)).toBe('sales');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    osSays = null;
    expect(await currentDesk('DBYA0150', 61_000)).toBeNull();
  });

  const hit = async (path: string, token: string) => proxy(new NextRequest(new URL(path, 'http://localhost:3000'), { headers: { cookie: `${SALES_SESSION_COOKIE}=${token}` } }));

  it('ends the desk once Auth Control takes it away', async () => {
    const token = await salesSessionToken('DBYA0150', 'sales', 'New Hire');
    expect((await hit('/sales/workspace', token)).status).not.toBe(303);
    clearDeskAccessCache();
    osSays = null;
    const res = await hit('/sales/workspace', token);
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${SALES_SESSION_COOKIE}=;`));
    clearDeskAccessCache();
    expect((await hit('/sales/api/claims', token)).status).toBe(401);
  });

  it('moved to the drivers desk: the sales session ends; the drivers one is limited to drivers', async () => {
    osSays = 'drivers';
    expect((await hit('/sales/workspace', await salesSessionToken('DBYA0150', 'sales', 'X'))).status).toBe(303);
    const drivers = await salesSessionToken('DBYA0150', 'drivers', 'X');
    expect((await hit('/api/marketing/dataset', drivers)).status).toBe(403);
    expect((await hit('/sales/workspace', drivers)).status).not.toBe(303);
  });

  it('keeps desks open while the OS cannot be asked', async () => {
    osUp = false;
    expect((await hit('/sales/workspace', await salesSessionToken('DBYA0150', 'sales', 'New Hire'))).status).not.toBe(303);
  });
});
