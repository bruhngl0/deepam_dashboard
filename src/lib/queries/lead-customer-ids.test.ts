/**
 * Leads carry a Lead ID (LED-), customers a Customer ID (CUS-) (drizzle/0026, 0027). Runs against
 * the database in .env.local (skipped without one); people are picked by shape, not by id.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';

beforeAll(() => {
  config({ path: '.env.local' });
});

const hasDb = Boolean(process.env.DATABASE_URL) || Boolean(config({ path: '.env.local' }).parsed?.DATABASE_URL);

async function one(statement: string) {
  const { query } = await import('./buyers');
  const { sql } = await import('drizzle-orm');
  return (await query(sql.raw(statement)))[0] as Record<string, string> | undefined;
}

describe.skipIf(!hasDb)('Lead IDs and Customer IDs', () => {
  it('gives a lead-only person a Lead ID and no Customer ID, on the counter card too', async () => {
    const lead = await one(`SELECT c.id, c.phone_national, person_lead_code(c.id) AS lead FROM customers c
      WHERE c.customer_code IS NULL AND person_lead_code(c.id) IS NOT NULL ORDER BY c.id LIMIT 1`);
    if (!lead) return;
    expect(lead.lead).toMatch(/^LED-\d{6}$/);
    const { getCustomerCard } = await import('./customer-timeline');
    const card = await getCustomerCard(lead.phone_national);
    expect(card).toMatchObject({ found: true, customerCode: null, leadCode: lead.lead });
  }, 60_000);

  it('opens a person by Lead ID, and by a Customer ID retired from a lead', async () => {
    const { getCustomerHeader } = await import('./customer-timeline');
    const retired = await one(`SELECT code, customer_id FROM customer_codes_retired ORDER BY code LIMIT 1`);
    if (retired) expect((await getCustomerHeader(retired.code))?.id).toBe(Number(retired.customer_id));
    const lead = await one(`SELECT lead_code, customer_id FROM lead_touches WHERE lead_code IS NOT NULL ORDER BY id LIMIT 1`);
    if (lead) expect((await getCustomerHeader(lead.lead_code))?.id).toBe(Number(lead.customer_id));
  }, 60_000);

  it('never gives a Customer ID to someone who does not qualify', async () => {
    const wrong = await one(`SELECT count(*) AS n FROM customers WHERE customer_code IS NOT NULL AND NOT customer_qualifies(id)`);
    expect(Number(wrong?.n)).toBe(0);
  }, 120_000);

  it('returns each lead with its IDs and never stores them', async () => {
    const { leadPage } = await import('@/lib/marketing/store');
    const page = await leadPage(0, 50);
    const withCode = page.rows.find((r) => r.lead.leadCode);
    if (!withCode) return;
    expect(withCode.lead.leadCode).toMatch(/^LED-\d{6}$/);
    const stored = await one(`SELECT doc FROM marketing_leads WHERE id = '${withCode.lead.id.replace(/'/g, "''")}'`);
    expect(JSON.stringify(stored?.doc)).not.toContain('leadCode');
  }, 60_000);
});

describe('lead labels', () => {
  it('shows the Lead ID, the Customer ID once they bought, and finds a lead by either', async () => {
    const { leadIdLabel, findLead, makeLead } = await import('@/lib/marketing/local');
    const lead = { ...makeLead({ phone: '+919000000001', name: 'A', source: 'Meta ads' }), leadCode: 'LED-000123', customerCode: null };
    expect(leadIdLabel(lead)).toBe('LED-000123');
    expect(leadIdLabel({ ...lead, customerCode: 'CUS-004211' })).toBe('LED-000123 · CUS-004211');
    expect(leadIdLabel({ ...lead, leadCode: null })).toBe('Lead ID pending');
    expect(findLead([lead], 'led-000123')).toBe(lead);
    expect(findLead([lead], lead.id)).toBe(lead);
  });
});
