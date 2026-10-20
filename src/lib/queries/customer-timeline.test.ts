/**
 * Customer timeline and counter card, against whatever database `.env.local`
 * points at (skipped without one). Customers are picked by shape, not by id,
 * so a re-import does not break the test.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { config } from 'dotenv';

beforeAll(() => {
  config({ path: '.env.local' });
});

vi.mock('@/lib/auth', () => ({ requireUser: async () => 'test-user', requireApiUser: async () => 'test-user' }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

const hasDb = Boolean(process.env.DATABASE_URL) || Boolean(config({ path: '.env.local' }).parsed?.DATABASE_URL);

async function pick(where: string) {
  const { query } = await import('./buyers');
  const { sql } = await import('drizzle-orm');
  const [row] = await query(sql.raw(`SELECT c.id, c.customer_code, c.phone_national FROM customers c WHERE ${where} ORDER BY c.id LIMIT 1`));
  return row as { id: number; customer_code: string; phone_national: string } | undefined;
}

describe.skipIf(!hasDb)('customer timeline', () => {
  it('lists bills newest first for a buyer', async () => {
    const { getCustomerHeader, getCustomerTimeline } = await import('./customer-timeline');
    const buyer = await pick('EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id)');
    expect(buyer).toBeDefined();
    const header = await getCustomerHeader(String(buyer!.id));
    const events = await getCustomerTimeline(header!);
    expect(events.some((e) => e.kind === 'bill')).toBe(true);
    for (let i = 1; i < events.length; i++) expect(events[i - 1].at >= events[i].at).toBe(true);
  }, 60_000);

  it('opens a walk-in-only customer by Customer ID instead of a 404', async () => {
    const customer = await pick('EXISTS (SELECT 1 FROM store_visits v WHERE v.customer_id = c.id AND v.deleted_at IS NULL) AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id)');
    if (!customer) return;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const page = (await import('@/app/crm/buyers/[id]/page')).default;
    const html = renderToStaticMarkup(
      (await page({ params: Promise.resolve({ id: customer.customer_code }), searchParams: Promise.resolve({}) })) as React.ReactElement,
    );
    expect(html).toContain('Timeline');
    expect(html).toContain('Walk-in');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  }, 60_000);

  it('gives the counter a card with no rupee amounts', async () => {
    const { getCustomerCard } = await import('./customer-timeline');
    const customer =
      (await pick('EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id) AND EXISTS (SELECT 1 FROM store_visits v WHERE v.customer_id = c.id)')) ??
      (await pick('EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id)'));
    const card = await getCustomerCard(customer!.phone_national);
    expect(card.found).toBe(true);
    if (!card.found) return;
    expect(card.customerCode).toBe(customer!.customer_code);
    expect(card.valueTier).not.toBe('none');
    expect(card.lastPurchase).not.toBeNull();
    expect(JSON.stringify(card)).not.toMatch(/amount|spend|₹/i);
  }, 60_000);

  it('says not found for a number CRM does not know', async () => {
    const { getCustomerCard } = await import('./customer-timeline');
    expect(await getCustomerCard('6000000001')).toEqual({ found: false });
    expect(await getCustomerCard('hello')).toEqual({ found: false });
  }, 60_000);
});

describe('customer-card route', () => {
  it('refuses a request without the integration token', async () => {
    process.env.INTEGRATION_API_TOKEN = 'test-token';
    const { POST } = await import('@/app/api/integration/customer-card/route');
    const res = await POST(new Request('http://crm.local/api/integration/customer-card', { method: 'POST', body: JSON.stringify({ contactNo: '9999999999' }) }));
    expect(res.status).toBe(401);
  });
});
