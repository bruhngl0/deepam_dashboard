/**
 * Channel performance — Instagram vs WhatsApp.
 *
 * The job is "compare magnitude, low → high", so: horizontal bars in a single
 * sequential hue, ordered by value, every bar direct-labeled. One measure across
 * categories is one series, so there is no legend and no categorical palette —
 * hue here would encode nothing.
 *
 * Each row carries two rates: all matched buyers, and the D-46 funnel rate with
 * existing customers and foreign numbers removed. The bar plots the first and
 * the sub-line states the second, because quoting either alone invites the
 * wrong conclusion — the gap between them *is* the finding.
 */

import { formatNumber, formatCurrency, CHANNEL_LABEL } from '@/lib/format';
import type { ChannelRow, Reach } from '@/lib/queries/dashboard';

export function ChannelPerformance({
  rows,
  reach,
}: {
  rows: ChannelRow[];
  reach: Reach;
}) {
  const ordered = [...rows].sort((a, b) => b.conversionRate - a.conversionRate);

  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight text-ink">
        Conversion by channel
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        Share of each channel&rsquo;s leads that went on to buy. Exclusive first touch,
        so the rows sum to the totals above. Bars are scaled 0&ndash;100%.
      </p>

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
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.max(0.6, Math.min(100, row.conversionRate))}%` }}
              />
            </div>

            <p className="tnum mt-1.5 text-xs text-ink-muted">
              {formatNumber(row.buyers)} of {formatNumber(row.people)} leads ·{' '}
              {formatNumber(row.bills)} bills · {formatCurrency(row.revenue)}
            </p>
            <p className="tnum mt-0.5 text-xs text-ink-muted">
              New customers only: {formatNumber(row.funnelBuyers)} of{' '}
              {formatNumber(row.funnelPeople)} ·{' '}
              {row.funnelConversionRate.toFixed(2)}% ·{' '}
              {formatCurrency(row.funnelRevenue)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-grid pt-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-muted">
          Raw reach, before first touch picks a winner
        </p>
        <table className="mt-3 w-full text-sm">
          <tbody>
            <tr className="align-baseline">
              <td className="py-1.5 pr-4 text-ink">Instagram numbers</td>
              <td className="tnum py-1.5 text-right text-ink-2">
                {formatNumber(reach.instagramPhones)}
              </td>
            </tr>
            <tr className="align-baseline">
              <td className="py-1.5 pr-4 text-ink">WhatsApp numbers</td>
              <td className="tnum py-1.5 text-right text-ink-2">
                {formatNumber(reach.whatsappPhones)}
              </td>
            </tr>
            <tr className="align-baseline">
              <td className="py-1.5 pr-4 text-ink">
                On both lists
                <span className="ml-2 text-xs text-ink-muted">
                  why the two cannot be added
                </span>
              </td>
              <td className="tnum py-1.5 text-right text-ink-2">
                {formatNumber(reach.inBoth)}
              </td>
            </tr>
            <tr className="align-baseline border-t border-grid">
              <td className="py-1.5 pr-4 font-medium text-ink">Distinct people reached</td>
              <td className="tnum py-1.5 text-right font-medium text-ink">
                {formatNumber(reach.unionPhones)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
