/**
 * Buyers — everyone who has actually placed a bill.
 *
 * The complement to the customer table on the dashboard, which lists leads and
 * therefore cannot show the 1,853 buyers who match no lead record at all
 * (D-86). Population here is the inverse: a bill is the price of admission and
 * a lead touch is just another column.
 *
 * The three tiles state the split this page exists to make honest — buyers,
 * how many of them came back, and how many had bought here before this file
 * was exported. Repeat is counted in *visits*, not bills; see the header of
 * `lib/queries/buyers.ts` for why that distinction is load-bearing.
 */

import { getBuyers } from '@/lib/queries/buyers';
import { parseDateParam } from '@/lib/queries/dashboard';
import { BuyerTable } from '@/components/buyer-table';
import { BuyerFilterBar } from '@/components/buyer-filters';
import { Pagination } from '@/components/filters';
import { StatTile } from '@/components/stat-tiles';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  VALUE_TIER_ORDER,
  type ValueTierCode,
} from '@/lib/format';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const SEGMENTS = ['repeat', 'one_time', 'reactivated', 'net_new'] as const;
type Segment = (typeof SEGMENTS)[number];

/** A stale bookmark drops the filter rather than erroring — same rule as the dashboard's `tierParam`. */
function segmentParam(value: string | undefined): Segment | undefined {
  return SEGMENTS.includes(value as Segment) ? (value as Segment) : undefined;
}

function tierParam(value: string | undefined): ValueTierCode | undefined {
  return VALUE_TIER_ORDER.includes(value as ValueTierCode) ? (value as ValueTierCode) : undefined;
}

export default async function BuyersPage({ searchParams }: { searchParams: SearchParams }) {
  // Before any query runs — the proxy redirect is not the boundary.
  await requireUser();

  const params = await searchParams;
  const from = parseDateParam(one(params.from));
  const to = parseDateParam(one(params.to));
  const store = one(params.store);

  const filters = {
    q: one(params.q),
    store,
    tier: tierParam(one(params.tier)),
    segment: segmentParam(one(params.segment)),
    from,
    to,
    sort: (one(params.sort) ?? 'spend') as 'spend' | 'recent' | 'visits' | 'name',
    page: Number(one(params.page) ?? 1),
    pageSize: Number(one(params.pageSize) ?? 50),
  };

  // The list under the current filters, plus the two population counts the
  // tiles report against. `total` on those two is the whole point — they are
  // deliberately *not* narrowed by q/tier/segment, so the denominators stay
  // stable while someone filters the table beneath them.
  const [buyers, repeat, returning] = await Promise.all([
    getBuyers(filters),
    getBuyers({ store, from, to, segment: 'repeat', pageSize: 10 }),
    getBuyers({ store, from, to, segment: 'reactivated', pageSize: 10 }),
  ]);

  const pageSpend = buyers.rows.reduce((n, r) => n + r.totalSpend, 0);

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Buyers</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
          Everyone who has placed a bill, whether or not they ever appeared on a lead sheet.
          Open any name for their full profile — spend, cadence, tender, branch, staff and
          prior history.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Buyers"
          value={formatNumber(buyers.buyerCount)}
          caption="Distinct people with at least one bill in this window"
          definition="Matched on normalised phone (D-03). Bills with no usable phone are real revenue but cannot be attributed to a person, so they are absent here."
        />
        <StatTile
          label="Came back"
          value={formatNumber(repeat.total)}
          caption={`${formatPercent(repeat.total, buyers.buyerCount)} of buyers made more than one visit`}
          definition="Counted in distinct visit dates, not bills. A second voucher on the same day is one trip split across tills, not a return trip — counting bills would roughly double this figure."
          emphasis
        />
        <StatTile
          label="Bought here before"
          value={formatNumber(returning.total)}
          caption={`${formatPercent(returning.total, buyers.buyerCount)} have bills predating this window`}
          definition="Evidence from the loyalty master export, the only source that predates the sales file. Not read from the customer lifecycle field, which classifies every buyer as existing by construction."
        />
      </div>

      <section className="card rounded-2xl border border-line bg-surface">
        <div className="flex flex-col gap-3 border-b border-grid px-4 py-4">
          <BuyerFilterBar total={buyers.total} />
          <p className="tnum text-xs text-ink-muted">
            Showing {formatNumber(buyers.rows.length)} of {formatNumber(buyers.total)} matching
            buyers · {formatCurrency(pageSpend)} of spend on this page
          </p>
        </div>

        <div className="p-4">
          <BuyerTable rows={buyers.rows} />
        </div>

        <div className="border-t border-grid px-4 py-3">
          <Pagination
            page={buyers.page}
            pageCount={buyers.pageCount}
            total={buyers.total}
            pageSize={buyers.pageSize}
          />
        </div>
      </section>
    </main>
  );
}
