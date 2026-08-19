/**
 * Render + write-path test for the worklist.
 *
 * Same shape and same reasoning as the buyer-pages smoke test: this screen is
 * mostly composition and copy that changes with the data, which no query-layer
 * unit test reaches. It carries one extra duty, though — the worklist is the
 * only screen that *writes*, so the suppression loop is asserted end to end:
 * log a contact, confirm the person leaves the list, confirm the override
 * brings them back, then delete the row so the test leaves no trace in a
 * database that is also production.
 *
 * Skips itself without DATABASE_URL so a CI run with no Postgres stays green.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { config } from 'dotenv';

beforeAll(() => {
  config({ path: '.env.local' });
});

vi.mock('@/lib/auth', () => ({
  requireUser: async () => 'test-user',
  requireApiUser: async () => 'test-user',
}));

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/crm/worklist',
  useSearchParams: () => new URLSearchParams(),
}));

const hasDb =
  Boolean(process.env.DATABASE_URL) || Boolean(config({ path: '.env.local' }).parsed?.DATABASE_URL);

describe.skipIf(!hasDb)('worklist', () => {
  it.each(['reactivation', 'second_visit'] as const)('renders the %s list', async (list) => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const page = (await import('./page')).default;

    const html = renderToStaticMarkup(
      (await page({ searchParams: Promise.resolve({ list }) })) as React.ReactElement,
    );

    expect(html).toContain('Worklist');
    expect(html).toContain('Score');
    // The freshness caveat must never be silently dropped.
    expect(html).toContain('Sales data is current through');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  }, 60_000);

  it('suppresses a contacted person and restores them on override', async () => {
    const { getReactivationList, recordContact } = await import('@/lib/queries/worklist');
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');

    const before = await getReactivationList({ pageSize: 10 });
    const target = before.rows[0];
    expect(target).toBeDefined();

    const { id } = await recordContact({
      customerId: target.customerId,
      listKind: 'reactivation',
      outcome: 'not_interested',
      note: 'vitest',
      score: target.score,
      userId: 'vitest',
    });

    try {
      const after = await getReactivationList({ pageSize: 10 });
      expect(after.rows.some((r) => r.customerId === target.customerId)).toBe(false);
      expect(after.meta.total).toBe(before.meta.total - 1);

      const override = await getReactivationList({ includeContacted: true, pageSize: 10 });
      const restored = override.rows.find((r) => r.customerId === target.customerId);
      expect(restored?.lastOutcome).toBe('not_interested');
      expect(restored?.contactCount).toBe(1);
    } finally {
      // Never leave test rows behind — this database serves the live app.
      await db.execute(sql`DELETE FROM outreach_contacts WHERE id = ${id}`);
    }

    const restoredPool = await getReactivationList({ pageSize: 10 });
    expect(restoredPool.meta.total).toBe(before.meta.total);
  }, 60_000);

  it('rejects bad input at the write boundary', async () => {
    const { POST } = await import('@/app/api/outreach/contact/route');
    const post = (body: unknown) =>
      POST(new Request('http://localhost/api/outreach/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));

    const base = { customerId: 1, listKind: 'reactivation', outcome: 'coming' };
    expect((await post({ ...base, customerId: 0 })).status).toBe(400);
    expect((await post({ ...base, customerId: 'abc' })).status).toBe(400);
    expect((await post({ ...base, listKind: 'nope' })).status).toBe(400);
    expect((await post({ ...base, outcome: "'; DROP TABLE sales;--" })).status).toBe(400);
    expect((await post({ ...base, outcome: 'not_a_status' })).status).toBe(400);

    const malformed = await POST(
      new Request('http://localhost/api/outreach/contact', { method: 'POST', body: 'not json' }),
    );
    expect(malformed.status).toBe(400);

    // Sanity: the table survived every one of the above.
    const { db } = await import('@/db');
    const { sql } = await import('drizzle-orm');
    const res = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM sales`)) as unknown;
    const rows = Array.isArray(res) ? res : (res as { rows: Record<string, unknown>[] }).rows;
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  }, 60_000);
});
