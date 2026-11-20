import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import proxy from './proxy';
import { SALES_SESSION_COOKIE, salesSessionToken } from '@/lib/sales-session';

async function hit(path: string, sales: boolean) {
  const headers = new Headers();
  if (sales) headers.set('cookie', `${SALES_SESSION_COOKIE}=${await salesSessionToken('DBYA0012')}`);
  return proxy(new NextRequest(new URL(path, 'http://localhost:3000'), { headers }));
}
const lockedTo = (res: Response) => (res.status === 303 ? new URL(res.headers.get('location')!).pathname : null);

describe('salesperson lock', () => {
  it('sends a calling-desk login from the hub and every module back to the desk', async () => {
    for (const path of ['/', '/flow', '/daily', '/hr', '/hr/employees', '/crm', '/crm/buyers', '/marketing', '/marketing-team', '/vendor', '/partners', '/store-manager', '/__gate']) {
      expect(lockedTo(await hit(path, true)), path).toBe('/sales/workspace');
    }
  });
  it('refuses every other API', async () => {
    for (const path of ['/api/integration/vendor-snapshot', '/api/marketing/leads', '/api/hr/employees']) {
      expect((await hit(path, true)).status, path).toBe(403);
    }
  });
  it('lets the desk, its own APIs and the health check through', async () => {
    for (const path of ['/sales', '/sales/workspace', '/sales/api/claims', '/api/marketing/dataset', '/api/marketing/calls', '/api/health']) {
      const res = await hit(path, true);
      expect(res.status, path).not.toBe(303);
      expect(res.status, path).not.toBe(403);
    }
  });
  it('leaves everyone without a calling-desk login alone', async () => {
    for (const path of ['/', '/hr', '/crm']) expect(lockedTo(await hit(path, false)), path).toBeNull();
  });
  it('ignores a forged desk cookie', async () => {
    const res = await proxy(new NextRequest(new URL('/hr', 'http://localhost:3000'), { headers: { cookie: `${SALES_SESSION_COOKIE}=DBYA0012.forged` } }));
    expect(lockedTo(res)).toBeNull();
  });
});
