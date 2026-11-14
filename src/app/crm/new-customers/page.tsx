/**
 * New customers: everyone who bought in the period and is not on the loyalty
 * customer list, split into lead-sheet buyers, walk-ins and other new buyers
 * (lib/queries/new-customers.ts). Opened from the dashboard's New customers
 * tile, keeping its period and store.
 */

import Link from 'next/link';
import { parseDateParam, getSalesDateBounds } from '@/lib/queries/dashboard';
import {
  getNewCustomerList,
  getNewCustomerSummary,
  getSalesBySource,
  newCustomerSegmentParam,
  NEW_CUSTOMER_SEGMENTS,
  NEW_CUSTOMER_SEGMENT_INFO,
  type NewCustomerSegment,
} from '@/lib/queries/new-customers';
import { Pagination } from '@/components/filters';
import { SalesBySourcePanel } from '@/components/sales-by-source';
import { StatTile } from '@/components/stat-tiles';
import { formatCurrency, formatCurrencyCompact, formatDate, formatNumber } from '@/lib/format';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewCustomersPage({ searchParams }: { searchParams: SearchParams }) {
  // Before any query runs — the proxy redirect is not the boundary.
  await requireUser();

  const params = await searchParams;
  const from = parseDateParam(one(params.from));
  const to = parseDateParam(one(params.to));
  const store = one(params.store) ?? null;
  const range = { from, to, store };
  const segment = newCustomerSegmentParam(one(params.segment));
  const q = one(params.q)?.trim() ?? '';

  const [summary, list, bounds, salesBySource] = await Promise.all([
    getNewCustomerSummary(range),
    getNewCustomerList(range, { segment, q, page: Number(one(params.page) ?? 1), pageSize: Number(one(params.pageSize) ?? 50) }),
    getSalesDateBounds(),
    getSalesBySource(range),
  ]);

  // Links keep the period, store and search; picking a group starts again from page 1.
  const href = (next: { segment?: NewCustomerSegment | null }) => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    if (store) query.set('store', store);
    if (q) query.set('q', q);
    const pick = next.segment === undefined ? segment : next.segment;
    if (pick) query.set('segment', pick);
    const qs = query.toString();
    return `/crm/new-customers${qs ? `?${qs}` : ''}`;
  };
  const backQuery = new URLSearchParams();
  if (from) backQuery.set('from', from);
  if (to) backQuery.set('to', to);
  if (store) backQuery.set('store', store);
  const back = `/crm${backQuery.toString() ? `?${backQuery}` : ''}`;
  const tile = 'block rounded-2xl transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent';
  const tab = (active: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm transition-colors ${active ? 'border-accent bg-accent text-white' : 'border-line text-ink-2 hover:bg-inset'}`;

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <Link href={back} className="text-sm font-medium text-accent hover:underline">← Dashboard</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">New customers</h1>
        <p className="mt-1 max-w-[72ch] text-sm text-ink-2">
          Everyone who bought between {formatDate(from ?? bounds.earliest)} and {formatDate(to ?? bounds.latest)}
          {store ? (store.includes(',') ? ' at these stores' : ' at this store') : ''} and is not on the loyalty customer sheet. Each person is in one group:
          a lead sheet first, then a walk-in, otherwise known only from their bill. Foreign numbers are left out.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href={href({ segment: null })} className={tile} aria-current={!segment ? 'page' : undefined}>
          <StatTile
            label="All new customers"
            value={formatNumber(summary.all.buyers)}
            caption={`${formatNumber(summary.all.bills)} bills · ${formatCurrencyCompact(summary.all.sales)}`}
            definition="The three groups added up."
            emphasis={!segment}
          />
        </Link>
        {NEW_CUSTOMER_SEGMENTS.map((key) => (
          <Link key={key} href={href({ segment: key })} className={tile} aria-current={segment === key ? 'page' : undefined}>
            <StatTile
              label={NEW_CUSTOMER_SEGMENT_INFO[key].label}
              value={formatNumber(summary[key].buyers)}
              caption={`${formatNumber(summary[key].bills)} bills · ${formatCurrencyCompact(summary[key].sales)}`}
              definition={NEW_CUSTOMER_SEGMENT_INFO[key].definition}
              emphasis={segment === key}
            />
          </Link>
        ))}
      </div>

      <div className="mb-6">
        <SalesBySourcePanel data={salesBySource} newCustomersHref={(key) => href({ segment: key })} />
      </div>

      <section className="card rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-grid px-4 py-4">
          <nav aria-label="Group" className="flex flex-wrap gap-2">
            <Link href={href({ segment: null })} className={tab(!segment)}>All</Link>
            {NEW_CUSTOMER_SEGMENTS.map((key) => (
              <Link key={key} href={href({ segment: key })} className={tab(segment === key)}>{NEW_CUSTOMER_SEGMENT_INFO[key].label}</Link>
            ))}
          </nav>
          <form className="flex gap-2" action="/crm/new-customers">
            {from && <input type="hidden" name="from" value={from} />}
            {to && <input type="hidden" name="to" value={to} />}
            {store && <input type="hidden" name="store" value={store} />}
            {segment && <input type="hidden" name="segment" value={segment} />}
            <input
              name="q"
              defaultValue={q}
              placeholder="Name, number or customer ID"
              className="w-64 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            />
            <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-inset">Search</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-inset text-left text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Group</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">First bill</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3 text-right">Bills</th>
                <th className="px-4 py-3 text-right">Sales</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.customerId} className="border-t border-grid">
                  <td className="px-4 py-3">
                    <Link href={`/crm/buyers/${row.customerId}`} className="font-medium text-accent hover:underline">
                      {row.name || 'No name'}
                    </Link>
                    <p className="tnum text-xs text-ink-muted">{[row.customerCode, row.phone].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-2">{NEW_CUSTOMER_SEGMENT_INFO[row.segment].label}</td>
                  <td className="px-4 py-3 text-ink-2">{row.source ?? '—'}</td>
                  <td className="tnum px-4 py-3 text-ink-2">{formatDate(row.firstBill)}</td>
                  <td className="px-4 py-3 text-ink-2">{row.store ?? '—'}</td>
                  <td className="tnum px-4 py-3 text-right text-ink-2">{formatNumber(row.bills)}</td>
                  <td className="tnum px-4 py-3 text-right text-ink">{formatCurrency(row.sales)}</td>
                </tr>
              ))}
              {!list.rows.length && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-muted">No new customers match.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={list.page} pageCount={list.pageCount} total={list.total} pageSize={list.pageSize} />
      </section>
    </main>
  );
}
