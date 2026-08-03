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
 */

import { Suspense } from 'react';
import {
  getKpis,
  getChannelBreakdown,
  getCampaignBreakdown,
  getReach,
  getStoreBreakdown,
  getDataQuality,
} from '@/lib/queries/dashboard';
import { getCustomers, getFilterOptions } from '@/lib/queries/customers';
import { KpiRow, SegmentRow } from '@/components/stat-tiles';
import { ChannelPerformance } from '@/components/channel-performance';
import { CampaignTable } from '@/components/campaign-table';
import { DataQualityPanel } from '@/components/data-quality';
import { CustomerTable } from '@/components/customer-table';
import { FilterBar, Pagination } from '@/components/filters';
import { formatCurrency, formatNumber } from '@/lib/format';
import { ThemeToggle } from '@/components/theme-toggle';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const filters = {
    q: one(params.q),
    store: one(params.store),
    channel: one(params.channel),
    lifecycle: one(params.lifecycle),
    hasSales: one(params.hasSales) as 'yes' | 'no' | undefined,
    sort: (one(params.sort) ?? 'sales') as 'sales' | 'recent' | 'name',
    page: Number(one(params.page) ?? 1),
    pageSize: Number(one(params.pageSize) ?? 25),
  };

  const [kpis, channels, campaigns, reach, stores, quality, customers, options] =
    await Promise.all([
      getKpis(),
      getChannelBreakdown(),
      getCampaignBreakdown(),
      getReach(),
      getStoreBreakdown(),
      getDataQuality(),
      getCustomers(filters),
      getFilterOptions(),
    ]);

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Deepam CRM</h1>
          <p className="mt-1 text-sm text-ink-2">
            Lead-to-sale attribution across Instagram, WhatsApp, Google Ads and other sources.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="space-y-3">
        <KpiRow
          totalLeads={kpis.totalLeads}
          leadsConverted={kpis.leadsConverted}
          conversionRate={kpis.conversionRate}
          attributedRevenue={kpis.attributedRevenue}
          attributedBills={kpis.attributedBills}
        />
        <SegmentRow
          newLeads={kpis.newLeads}
          newConverted={kpis.newConverted}
          newRevenue={kpis.newRevenue}
          existingPeople={kpis.existingPeople}
          existingBuyers={kpis.existingBuyers}
          existingRevenue={kpis.existingRevenue}
          grossSales={kpis.grossSales}
          totalBills={kpis.totalBills}
        />
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <ChannelPerformance rows={channels} reach={reach} />
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
            <FilterBar stores={options.stores} channels={options.channels} />
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
