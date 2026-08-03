/**
 * Dashboard — all four master-sheet channels.
 *
 * A Server Component reading straight from SQL — no client data-fetching layer.
 * Filter state lives in the URL, so every view is shareable.
 *
 * Scope covers Meta, WhatsApp, Google Ads and Others (D-86). `Others` is
 * store-sourced and converts far above the digital channels, which lifts the
 * blended rate — see the note at the top of `lib/queries/dashboard.ts` before
 * quoting the headline figure as an acquisition result.
 *
 * `from`/`to` bound every sales-derived figure on the page to a period, the
 * same way every other filter narrows the customer table — see `DateRange` in
 * `lib/queries/dashboard.ts` for exactly what is and is not windowed by it.
 * Unset means the full loaded period, so nothing changes until someone picks
 * a date; the header states which period is actually showing either way, so
 * a number is never read without knowing what window produced it.
 */

import { Suspense } from 'react';
import {
  getKpis,
  getChannelBreakdown,
  getCampaignBreakdown,
  getListOverlap,
  getStoreBreakdown,
  getStoreChannelMix,
  getCustomerValueTiers,
  getDataQuality,
  getSalesDateBounds,
  parseDateParam,
  type DateRange,
} from '@/lib/queries/dashboard';
import { getCustomers, getFilterOptions } from '@/lib/queries/customers';
import { KpiRow, RevenueRow } from '@/components/stat-tiles';
import { ChannelPerformance } from '@/components/channel-performance';
import { CampaignTable } from '@/components/campaign-table';
import { StoreChannelMixPanel } from '@/components/store-channel-mix';
import { CustomerValuePanel } from '@/components/customer-value';
import { DataQualityPanel } from '@/components/data-quality';
import { CustomerTable } from '@/components/customer-table';
import { FilterBar, Pagination } from '@/components/filters';
import {
  formatCurrency,
  formatNumber,
  formatDate,
  VALUE_TIER_ORDER,
  type ValueTierCode,
} from '@/lib/format';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Value tiers have no enum cast the way `channel`/`lifecycle` do, so a bad
 * value in the URL would otherwise match zero rows silently rather than error.
 * Dropped instead of forwarded — a stale bookmark loses the filter, not the
 * whole page.
 */
function tierParam(value: string | undefined): ValueTierCode | undefined {
  return VALUE_TIER_ORDER.includes(value as ValueTierCode) ? (value as ValueTierCode) : undefined;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Before any query runs — the proxy redirect is not the boundary.
  await requireUser();

  const params = await searchParams;

  const from = parseDateParam(one(params.from));
  const to = parseDateParam(one(params.to));
  const range: DateRange = { from, to };

  const filters = {
    q: one(params.q),
    store: one(params.store),
    channel: one(params.channel),
    lifecycle: one(params.lifecycle),
    hasSales: one(params.hasSales) as 'yes' | 'no' | undefined,
    tier: tierParam(one(params.tier)),
    from,
    to,
    sort: (one(params.sort) ?? 'sales') as 'sales' | 'recent' | 'name',
    page: Number(one(params.page) ?? 1),
    pageSize: Number(one(params.pageSize) ?? 25),
  };

  const [
    kpis,
    channels,
    campaigns,
    overlap,
    stores,
    storeMix,
    valueTiers,
    quality,
    dateBounds,
    customers,
    options,
  ] = await Promise.all([
    getKpis(range),
    getChannelBreakdown(range),
    getCampaignBreakdown(range),
    getListOverlap(),
    getStoreBreakdown(range),
    getStoreChannelMix(range),
    getCustomerValueTiers(),
    getDataQuality(range),
    getSalesDateBounds(),
    getCustomers(filters),
    getFilterOptions(),
  ]);

  const periodFrom = from ?? dateBounds.earliest;
  const periodTo = to ?? dateBounds.latest;
  const isFullPeriod = !from && !to;

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-2">
          Lead-to-sale attribution across Instagram, WhatsApp, Google Ads and other sources.
        </p>
        {periodFrom && periodTo && (
          <p className="tnum mt-2 text-xs text-ink-muted">
            Showing {formatDate(periodFrom)} – {formatDate(periodTo)}
            {isFullPeriod
              ? ' — every bill loaded.'
              : ` of ${formatDate(dateBounds.earliest)} – ${formatDate(dateBounds.latest)} loaded.`}
            {' '}Leads and the Customer value panel are unaffected — see their own notes.
          </p>
        )}
      </header>

      <div className="space-y-3">
        <KpiRow
          totalLeads={kpis.totalLeads}
          leadsConverted={kpis.leadsConverted}
          conversionRate={kpis.conversionRate}
          attributedRevenue={kpis.attributedRevenue}
        />
        <RevenueRow
          newLeads={kpis.newLeads}
          newConverted={kpis.newConverted}
          newRevenue={kpis.newRevenue}
          existingPeople={kpis.existingPeople}
          existingBuyers={kpis.existingBuyers}
          existingRevenue={kpis.existingRevenue}
          existingBills={kpis.existingBills}
          phonelessBills={kpis.phonelessBills}
          phonelessRevenue={kpis.phonelessRevenue}
          grossSales={kpis.grossSales}
          totalBills={kpis.totalBills}
          attributedBills={kpis.attributedBills}
        />
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <ChannelPerformance rows={channels} overlap={overlap} />
        <div className="space-y-3">
          <CampaignTable rows={campaigns} />
          <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <h2 className="text-lg font-semibold tracking-tight text-ink">By store</h2>
            <p className="mt-1 text-sm text-ink-2">
              All billed revenue, and the share traceable to a lead.
            </p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">
                  <th className="pb-2 text-left font-medium">Store</th>
                  <th className="pb-2 text-right font-medium">Bills</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                  <th className="pb-2 text-right font-medium">Attributed</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.code} className="border-t border-grid">
                    <td className="py-2.5 text-ink">
                      {s.name}
                      <span className="ml-2 text-xs text-ink-muted">{s.voucherPrefix}</span>
                    </td>
                    <td className="tnum py-2.5 text-right text-ink-2">
                      {formatNumber(s.bills)}
                    </td>
                    <td className="tnum py-2.5 text-right font-medium text-ink">
                      {formatCurrency(s.revenue)}
                    </td>
                    <td className="tnum py-2.5 text-right text-ink-2">
                      {formatCurrency(s.attributedRevenue)}
                      <span className="ml-1.5 text-xs text-ink-muted">
                        {formatNumber(s.attributedBills)} bills
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <DataQualityPanel quality={quality} />
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <StoreChannelMixPanel stores={storeMix} />
        <CustomerValuePanel data={valueTiers} />
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex flex-col gap-4 p-6 pb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">Customers</h2>
            <p className="mt-1 text-sm text-ink-2">
              Every person on a master-sheet lead list — {formatNumber(customers.total)} in this
              view.
            </p>
          </div>
          <Suspense fallback={<div className="h-10" />}>
            <FilterBar stores={options.stores} channels={options.channels} dateBounds={dateBounds} />
          </Suspense>
        </div>

        <CustomerTable rows={customers.rows} />

        <Suspense fallback={null}>
          <Pagination
            page={customers.page}
            pageCount={customers.pageCount}
            total={customers.total}
            pageSize={customers.pageSize}
          />
        </Suspense>
      </section>
    </main>
  );
}
