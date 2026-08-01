/**
 * Channel performance — table + bar.
 *
 * The job is "compare magnitude, low → high", so: horizontal bars in a single
 * sequential hue, ordered by value, every bar direct-labeled. One measure across
 * categories is one series, so there is no legend and no categorical palette —
 * hue here would encode nothing.
 *
 * Only *acquisition* channels are plotted. The existing-customer segments are
 * excluded on purpose: `no_lead_match` converts at 100% by construction (the
 * group is defined by having bought), and putting a constructed 100% beside
 * three measured rates would invite a false comparison. Those segments appear
 * in the table below with their basis shown.
 */

import { formatNumber, formatCurrency, CHANNEL_LABEL } from '@/lib/format';
import type { ChannelRow } from '@/lib/queries/dashboard';

const ACQUISITION = new Set(['meta', 'whatsapp', 'walkin', 'google', 'referral', 'other']);

export function ChannelPerformance({ rows }: { rows: ChannelRow[] }) {
  const acquisition = rows
    .filter((r) => ACQUISITION.has(r.channel))
    .sort((a, b) => b.conversionRate - a.conversionRate);

  const existing = rows.filter((r) => !ACQUISITION.has(r.channel));

  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight text-ink">
        Conversion by acquisition channel
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        Share of each channel&rsquo;s leads that went on to buy this period. Bars are
        scaled 0&ndash;100%.
      </p>

      <div className="mt-5 space-y-4">
        {acquisition.map((row) => (
          <div key={row.channel}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium text-ink">
                {CHANNEL_LABEL[row.channel] ?? row.channel}
              </span>
              <span className="tnum text-sm font-semibold text-ink">
                {row.conversionRate.toFixed(1)}%
              </span>
            </div>

            {/* The track is the full 0–100% scale, not the largest value.
                Normalising to the max would render 43% as a full bar and make
                the best channel look like a ceiling it has not reached — the
                mark would misstate the number it is labelled with.
                Track is a light step of the same hue; the fill is anchored to
                the baseline with a rounded data-end. */}
            <div
              className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-accent-soft/50"
              role="img"
              aria-label={`${row.conversionRate.toFixed(1)} percent of ${row.people} leads converted`}
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.max(0.6, Math.min(100, row.conversionRate))}%` }}
              />
            </div>

            <p className="tnum mt-1.5 text-xs text-ink-muted">
              {formatNumber(row.buyers)} of {formatNumber(row.people)} leads ·{' '}
              {formatCurrency(row.revenue)}
            </p>
          </div>
        ))}
      </div>

      {existing.length > 0 && (
        <div className="mt-6 border-t border-grid pt-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-muted">
            Existing customers — excluded from the funnel
          </p>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {existing.map((row) => (
                <tr key={`${row.channel}-${row.basis}`} className="align-baseline">
                  <td className="py-1.5 pr-4 text-ink">
                    {row.basis === 'no_lead_match'
                      ? 'Bought, no lead record'
                      : row.basis === 'self_declared'
                        ? 'Said "existing" on the form'
                        : row.basis === 'prior_purchase'
                          ? 'Purchased before this window'
                          : 'Existing'}
                    {row.basis === 'no_lead_match' && (
                      <span className="ml-2 text-xs text-ink-muted">inferred</span>
                    )}
                  </td>
                  <td className="tnum py-1.5 pr-4 text-right text-ink-2">
                    {formatNumber(row.buyers)} / {formatNumber(row.people)}
                  </td>
                  <td className="tnum py-1.5 text-right font-medium text-ink">
                    {formatCurrency(row.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
