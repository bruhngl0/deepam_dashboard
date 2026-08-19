/**
 * Vendor dashboard — stock ledger and item-level sales, joined by barcode.
 *
 * A Server Component reading straight from `lib/queries/vendor.ts` — no
 * client data-fetching layer, same shape as `/crm`. Independent of the CRM's
 * customer/lead data by design (D-64): this page never joins `customers`.
 */

import {
  getVendorKpis,
  getVendorBreakdown,
  getItemGroupBreakdown,
  getMarginByVendor,
  getDeadStock,
  getSaleLineItemCoverage,
} from '@/lib/queries/vendor';
import { HeroTile, StatTile } from '@/components/stat-tiles';
import { Finding, Note, Bar } from '@/components/finding-card';
import { formatCurrency, formatCurrencyCompact, formatNumber } from '@/lib/format';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function VendorPage() {
  // Before any query runs — the proxy redirect is not the boundary.
  await requireUser();

  const [kpis, vendors, itemGroups, margin, deadStock, coverage] = await Promise.all([
    getVendorKpis(),
    getVendorBreakdown(),
    getItemGroupBreakdown(),
    getMarginByVendor(),
    getDeadStock(),
    getSaleLineItemCoverage(),
  ]);

  const maxVendorPurchase = Math.max(...vendors.map((v) => v.purchaseAmount), 1);
  const maxGroupPurchase = Math.max(...itemGroups.map((g) => g.purchaseAmount), 1);
  const maxMarginRevenue = Math.max(...margin.map((m) => m.revenue), 1);

  const coverageTotal = coverage.matchedLines + coverage.unmatchedLines;
  const coveragePct = coverageTotal ? (100 * coverage.matchedLines) / coverageTotal : 0;

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Vendor</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
          Purchase, sell-through and margin by vendor and item, from the latest stock ledger
          snapshot per barcode. Margin figures are approximate — see the note on the vendor
          queries module for why.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeroTile
          label="Purchases"
          value={formatCurrencyCompact(kpis.purchaseAmount)}
          caption={`${formatNumber(kpis.vendorCount)} vendors · ${formatNumber(kpis.barcodeCount)} barcodes`}
        />
        <StatTile
          label="Net sales"
          value={formatCurrencyCompact(kpis.netSalesAmount)}
          caption={formatCurrency(kpis.netSalesAmount)}
        />
        <StatTile
          label="Closing value"
          value={formatCurrencyCompact(kpis.closingValue)}
          caption="Stock on hand, at the latest snapshot"
        />
        <StatTile
          label="Sell-through"
          value={`${kpis.sellThroughPct.toFixed(1)}%`}
          caption="Net sales ÷ purchases, by value"
          emphasis
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Finding
          eyebrow="Vendor breakdown"
          title={`${formatNumber(vendors.length)} vendors tracked`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b border-grid text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                  <th className="px-2 py-2 text-left font-bold">Vendor</th>
                  <th className="px-2 py-2 text-right font-bold">Purchases</th>
                  <th className="px-2 py-2 text-right font-bold">Sell-through</th>
                </tr>
              </thead>
              <tbody>
                {vendors.slice(0, 15).map((v) => (
                  <tr key={v.vendorName} className="border-t border-grid align-baseline">
                    <td className="px-2 py-2 text-ink">{v.vendorName}</td>
                    <td className="tnum px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="hidden w-16 sm:block">
                          <Bar value={v.purchaseAmount} scale={maxVendorPurchase} />
                        </span>
                        <span className="font-medium text-ink">
                          {formatCurrencyCompact(v.purchaseAmount)}
                        </span>
                      </div>
                    </td>
                    <td className="tnum px-2 py-2 text-right text-ink-2">
                      {v.sellThroughPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>Top 15 vendors by purchase value. Sell-through is net sales ÷ purchases.</Note>
        </Finding>

        <Finding
          eyebrow="Item group breakdown"
          title={`${formatNumber(itemGroups.length)} item groups`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b border-grid text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                  <th className="px-2 py-2 text-left font-bold">Group</th>
                  <th className="px-2 py-2 text-right font-bold">Purchases</th>
                  <th className="px-2 py-2 text-right font-bold">Sell-through</th>
                </tr>
              </thead>
              <tbody>
                {itemGroups.slice(0, 15).map((g) => (
                  <tr key={g.itemGroupName} className="border-t border-grid align-baseline">
                    <td className="px-2 py-2 text-ink">{g.itemGroupName}</td>
                    <td className="tnum px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="hidden w-16 sm:block">
                          <Bar value={g.purchaseAmount} scale={maxGroupPurchase} />
                        </span>
                        <span className="font-medium text-ink">
                          {formatCurrencyCompact(g.purchaseAmount)}
                        </span>
                      </div>
                    </td>
                    <td className="tnum px-2 py-2 text-right text-ink-2">
                      {g.sellThroughPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>Top 15 groups by purchase value.</Note>
        </Finding>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Finding
          eyebrow="Margin by vendor (approximate)"
          title={
            margin.length
              ? `${formatNumber(margin.length)} vendors with matched sale lines`
              : 'No item-level sales matched to a vendor yet'
          }
        >
          {margin.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b border-grid text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                    <th className="px-2 py-2 text-left font-bold">Vendor</th>
                    <th className="px-2 py-2 text-right font-bold">Revenue</th>
                    <th className="px-2 py-2 text-right font-bold">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {margin.slice(0, 15).map((m) => (
                    <tr key={m.vendorName} className="border-t border-grid align-baseline">
                      <td className="px-2 py-2 text-ink">{m.vendorName}</td>
                      <td className="tnum px-2 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="hidden w-16 sm:block">
                            <Bar value={m.revenue} scale={maxMarginRevenue} />
                          </span>
                          <span className="font-medium text-ink">
                            {formatCurrencyCompact(m.revenue)}
                          </span>
                        </div>
                      </td>
                      <td className="tnum px-2 py-2 text-right text-ink-2">
                        {formatCurrencyCompact(m.margin)} ({m.marginPct.toFixed(1)}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-ink-2">
              {coverageTotal > 0
                ? // Line items exist (coverage panel below has the count) but
                  // none resolved to a vendor — the barcode-wise sales file is
                  // in, the vendor stock ledger isn't, so there's nothing to
                  // join barcode → vendor against yet.
                  'Item-level sales are loaded, but no vendor stock ledger has been imported yet — barcode → vendor needs that file to resolve.'
                : 'Import a barcode-wise sales register to populate this table.'}
            </p>
          )}
          <Note>
            Cost basis is the line item&rsquo;s own printed cost at time of sale, not the
            vendor ledger&rsquo;s purchase amount — the two files snapshot cost at different
            times and are never reconciled here.
          </Note>
        </Finding>

        <Finding
          eyebrow="Dead stock"
          title={
            deadStock.length
              ? `${formatNumber(deadStock.length)} barcodes bought but essentially never sold`
              : 'No dead stock found'
          }
        >
          {deadStock.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b border-grid text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                    <th className="px-2 py-2 text-left font-bold">Barcode</th>
                    <th className="px-2 py-2 text-left font-bold">Vendor</th>
                    <th className="px-2 py-2 text-right font-bold">Closing value</th>
                  </tr>
                </thead>
                <tbody>
                  {deadStock.slice(0, 15).map((d) => (
                    <tr key={d.barcode} className="border-t border-grid align-baseline">
                      <td className="px-2 py-2 text-ink">{d.barcode}</td>
                      <td className="px-2 py-2 text-ink-2">{d.vendorName}</td>
                      <td className="tnum px-2 py-2 text-right font-medium text-ink">
                        {formatCurrencyCompact(d.clAmt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-ink-2">
              Nothing has a purchase quantity with zero net sales and remaining closing stock.
            </p>
          )}
          <Note>Purchased, net sales at or below zero, and closing quantity still on hand.</Note>
        </Finding>
      </div>

      <section className="card mt-3 rounded-2xl border border-line bg-surface p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
          Data quality
        </p>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-ink">
          {formatNumber(coverage.matchedLines)} of {formatNumber(coverageTotal)} item-level
          sale lines matched to a bill
        </h2>
        <div className="mt-3 max-w-md">
          <Bar value={coveragePct} scale={100} />
        </div>
        <p className="mt-2 text-sm text-ink-2">
          {coveragePct.toFixed(1)}% matched · {formatNumber(coverage.unmatchedLines)} unmatched (
          {formatCurrency(coverage.unmatchedAmount)}) — most likely Online-channel orders or
          dates outside what&rsquo;s been imported into the CRM&rsquo;s sales table. Kept and
          flagged, never dropped.
        </p>
      </section>
    </main>
  );
}
