/**
 * Render smoke test for the buyer pages.
 *
 * Every other test in this repo is a pure parser test with no I/O. This one is
 * different on purpose: the two buyer pages are almost entirely *composition*
 * — plurals, shares, empty states, and copy that changes shape depending on
 * whether a buyer visited once or nine times, paid one tender or four, and had
 * history before this sales window or none. None of that is reachable from a
 * unit test of the query layer, and all of it is where the bugs actually were
 * (it caught a "2 salesmanpeople", a headline that rounded 4.9 years to 5, and
 * a payment panel that silently omitted ₹3.8 L of untendered spend).
 *
 * It needs a database, so it skips itself when `DATABASE_URL` is unset rather
 * than failing a CI run that has no Postgres. The three buyers it renders are
 * *selected by shape*, not hardcoded by id — a fixture id would rot the first
 * time someone re-imported the sales file.
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

// The filter bar's hooks have no app router in this harness. In the real app
// it is a client boundary the server render never executes.
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/crm/buyers',
  useSearchParams: () => new URLSearchParams(),
}));

const hasDb = Boolean(process.env.DATABASE_URL) || Boolean(config({ path: '.env.local' }).parsed?.DATABASE_URL);

describe.skipIf(!hasDb)('buyer pages', () => {
  it('renders the buyer list', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const page = (await import('./page')).default;

    const html = renderToStaticMarkup(
      (await page({ searchParams: Promise.resolve({ sort: 'visits' }) })) as React.ReactElement,
    );

    expect(html).toContain('Came back');
    expect(html).toContain('Bought here before');
    // The frequency column must never collapse visits and bills into one word.
    expect(html).toMatch(/visits?<\/?/);
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  }, 60_000);

  it.each([
    ['a buyer who came back', { segment: 'repeat', sort: 'visits' }],
    ['a buyer with history before this window', { segment: 'reactivated' }],
    ['a single-visit buyer', { segment: 'one_time' }],
  ] as const)('renders %s', async (_label, filters) => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { getBuyers } = await import('@/lib/queries/buyers');
    const page = (await import('./[id]/page')).default;

    const { rows } = await getBuyers({ ...filters, pageSize: 10 });
    expect(rows.length).toBeGreaterThan(0);

    const html = renderToStaticMarkup(
      (await page({
        params: Promise.resolve({ id: String(rows[0].id) }),
        searchParams: Promise.resolve({}),
      })) as React.ReactElement,
    );

    expect(html).toContain('Visit log');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    // Plural agreement is generated, not literal — assert the broken forms are gone.
    expect(html).not.toContain('salesmanpeople');
    expect(html).not.toContain('1 visits');
    expect(html).not.toContain('1 bills,');
  }, 60_000);
});
