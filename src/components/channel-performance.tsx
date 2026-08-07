/**
 * Channel performance across the four master-sheet channels.
 *
 * The job is "compare magnitude, low → high", so: horizontal bars in a single
 * sequential hue, ordered by value, every bar direct-labeled. One measure across
 * categories is one series, so there is no legend and no categorical palette —
 * hue here would encode nothing.
 *
 * Each row carries two rates: all matched buyers, and the D-46 funnel rate with
 * existing customers and foreign numbers removed. The bar plots the first and
 * the sub-line states the second, because quoting either alone invites the
 * wrong conclusion — the gap between them *is* the finding. That gap is widest
 * on `other`, which is store-sourced: most of its buyers were already customers
 * (D-86), so its headline rate says little about acquisition.
 *
 * Average bill and revenue per buyer sit beside the rate for the same reason:
 * sorted by conversion rate, Google Ads leads the list, but its buyers are
 * worth roughly half an Others buyer. Reading the rate column alone moves
 * budget the wrong way — see the Insights page for the full comparison.
 */

import { formatNumber, formatCurrency, CHANNEL_LABEL } from '@/lib/format';
import type { ChannelRow, ListOverlap } from '@/lib/queries/dashboard';

const channelLabel = (code: string) => CHANNEL_LABEL[code] ?? code;

export function ChannelPerformance({
  rows,
  overlap,
}: {
  rows: ChannelRow[];
  overlap: ListOverlap;
}) {
  const ordered = [...rows].sort((a, b) => b.conversionRate - a.conversionRate);

  // The D-46 funnel line only earns its space when it disagrees with the line
  // above it. Since the master-sheet load (D-84) no lead is flagged existing —
  // the 284 existing customers have no lead touch, and the walk-in form that
  // supplied `self_declared` is gone — so the filter currently removes nobody
  // and every pair is identical. Printing the same figures twice would imply a
  // distinction is being drawn where none is.
  const funnelDiffers = rows.some(
    (r) => r.funnelPeople !== r.people || r.funnelBuyers !== r.buyers,
  );

  return (
    <section className="card rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">
        Conversion by channel
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        Share of each channel&rsquo;s leads that went on to buy. Exclusive first touch,
        so the rows sum to the totals above. Bars are scaled 0&ndash;100%.
      </p>
      {!funnelDiffers && (
        <p className="mt-2 text-xs text-ink-muted">
          Every lead here counts as a new customer, so the new-customer-only rate is
          identical to the rate shown and is omitted. Nothing is being filtered: the
          master sheet carries no prior-customer evidence, so people who had already
          bought are indistinguishable from genuine acquisitions.
        </p>
      )}

      <div className="mt-5 space-y-4">
        {ordered.map((row) => (
          <div key={row.channel}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium text-ink">
                {CHANNEL_LABEL[row.channel] ?? row.channel}
              </span>
              <span className="tnum text-sm font-semibold text-ink">
                {row.conversionRate.toFixed(2)}%
              </span>
            </div>

            {/* The track is the full 0–100% scale, not the largest value.
                Normalising to the max would render 4.9% as a full bar and make
                the better channel look like a ceiling it has not reached — the
                mark would misstate the number it is labelled with.
                Track is a light step of the same hue; the fill is anchored to
                the baseline with a rounded data-end. */}
            <div
              className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-accent-soft/50"
              role="img"
              aria-label={`${row.conversionRate.toFixed(2)} percent of ${row.people} leads converted`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong transition-[width] duration-700 ease-out"
                style={{ width: `${Math.max(0.6, Math.min(100, row.conversionRate))}%` }}
              />
            </div>

            <p className="tnum mt-1.5 text-xs text-ink-muted">
              {formatNumber(row.buyers)} of {formatNumber(row.people)} leads ·{' '}
              {formatNumber(row.bills)} bills · {formatCurrency(row.revenue)}
            </p>
            <p className="tnum mt-0.5 text-xs text-ink-muted">
              {formatCurrency(row.averageBill)} avg bill ·{' '}
              {formatCurrency(row.revenuePerBuyer)} per buyer
            </p>
            {funnelDiffers && (
              <p className="tnum mt-0.5 text-xs text-ink-muted">
                New customers only: {formatNumber(row.funnelBuyers)} of{' '}
                {formatNumber(row.funnelPeople)} ·{' '}
                {row.funnelConversionRate.toFixed(2)}% ·{' '}
                {formatCurrency(row.funnelRevenue)}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-grid pt-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
          The actual distribution
        </p>
        <p className="mt-1.5 text-sm text-ink-2">
          {formatNumber(overlap.onOneList)} people are on exactly one list,{' '}
          {formatNumber(overlap.onTwoLists)} on two, {formatNumber(overlap.onThreeOrMore)} on
          all three.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[22rem] text-sm">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                <th className="pb-2 text-left font-bold">On these lists</th>
                <th className="pb-2 text-right font-bold">People</th>
                <th className="pb-2 text-right font-bold">Bought</th>
              </tr>
            </thead>
            <tbody>
              {overlap.combinations.map((c) => (
                <tr key={c.channels.join('+')} className="border-t border-grid align-baseline">
                  <td className="py-2 pr-4 text-ink">
                    {c.channels.map(channelLabel).join(' + ')}
                    {c.channels.length === 1 && (
                      <span className="text-ink-muted"> only</span>
                    )}
                  </td>
                  <td className="tnum py-2 text-right text-ink-2">
                    {formatNumber(c.people)}
                  </td>
                  <td className="tnum py-2 text-right text-ink-2">
                    {formatNumber(c.buyers)}
                  </td>
                </tr>
              ))}
              {/* The rows are disjoint sets, so unlike per-channel reach they
                  genuinely add up — the total is worth stating for that reason. */}
              <tr className="border-t border-line align-baseline">
                <td className="py-2 pr-4 font-medium text-ink">Distinct people reached</td>
                <td className="tnum py-2 text-right font-medium text-ink">
                  {formatNumber(overlap.totalPeople)}
                </td>
                <td className="tnum py-2 text-right font-medium text-ink">
                  {formatNumber(overlap.totalBuyers)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
