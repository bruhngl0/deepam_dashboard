/**
 * Daily dashboard against the database in .env.local (skipped without one). RC Dashboard
 * and Vendor Intelligence are stubbed with fetch so the test never leaves this machine.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from 'dotenv';

beforeAll(() => {
  config({ path: '.env.local' });
});

vi.mock('@/lib/auth', () => ({ requireUser: async () => 'test-user', requireApiUser: async () => 'test-user' }));

const hasDb = Boolean(process.env.DATABASE_URL) || Boolean(config({ path: '.env.local' }).parsed?.DATABASE_URL);

async function render(date: string) {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const page = (await import('./page')).default;
  return renderToStaticMarkup((await page({ searchParams: Promise.resolve({ date }) })) as React.ReactElement);
}

describe('daily helpers', () => {
  it('moves between days and rejects bad dates', async () => {
    const { isDay, shiftDay } = await import('@/lib/queries/daily');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(isDay('2026-10-20')).toBe(true);
    expect(isDay('2026-13-40')).toBe(false);
    expect(isDay('yesterday')).toBe(false);
  });
});

describe.skipIf(!hasDb)('daily dashboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RC_URL;
    delete process.env.RC_INTEGRATION_TOKEN;
    delete process.env.VENDOR_URL;
  });

  it('renders CRM figures and says when RC and Vendor Intelligence are not available', async () => {
    const html = await render('2026-10-15');
    expect(html).toContain('Walk-ins (WalkTrack)');
    expect(html).toContain('Average bill value');
    expect(html.match(/Not available right now/g)?.length).toBe(2);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  }, 60_000);

  it('puts RC commission and Vendor stock alerts under the right store', async () => {
    process.env.RC_URL = 'http://rc.local';
    process.env.RC_INTEGRATION_TOKEN = 'rc-token';
    process.env.VENDOR_URL = 'http://vendor.local';
    process.env.INTEGRATION_API_TOKEN = 'crm-token';
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization');
      if (String(url).startsWith('http://rc.local/api/integration/daily?date=2026-10-15')) {
        expect(auth).toBe('Bearer rc-token');
        return Response.json({ date: '2026-10-15', day: [{ storeCode: 'STR-001', visits: 4, people: 9, convertedVisits: 2, billAmount: 50000, commission: 1234 }], owed: [{ storeCode: 'STR-001', visits: 3, commission: 98765 }] });
      }
      if (String(url) === 'http://vendor.local/api/integration/stock-alerts') {
        expect(auth).toBe('Bearer crm-token');
        return Response.json({
          asOf: '2026-10-14', salesThrough: '2026-10-14',
          rules: { agedDays: 90, fastSellerDays: 30, fastSellerMinSold: 3, lowStockMax: 1 },
          stores: [{ storeCode: 'STR-002', aged: { units: 17, cost: 45600, items: [{ vendor: 'TEST VENDOR', item: 'SILK', units: 17, cost: 45600, oldestInward: '2026-01-02' }] }, lowFastSellers: [{ vendor: 'TEST VENDOR', item: 'LEHENGA', left: 1, soldLast30Days: 8 }] }],
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const html = await render('2026-10-15');
    expect(html).not.toContain('Not available right now');
    expect(html).toContain('₹98,765 · 3');
    expect(html).toContain('₹1,234');
    expect(html).toContain('17 units');
    expect(html).toContain('TEST VENDOR · LEHENGA: 1 left, 8 sold in 30 days');
    expect(fetch).toHaveBeenCalledTimes(2);
  }, 60_000);
});
