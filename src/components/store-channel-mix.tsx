/**
 * Branch × channel matrix.
 *
 * The store panel and the channel panel never cross on their own — one reports
 * revenue per branch, the other reports revenue per channel, and neither says
 * whether a branch's revenue is mostly repeat customers or mostly newly
 * acquired ones. Two branches can post similar totals while running on
 * entirely different kinds of customer, and this is the only place that shows
 * it.
 *
 * Small multiples — one single-hue block per store — rather than grouped bars,
 * so telling the stores apart needs no categorical palette. Shares are of each
 * store's own identified revenue, not of the business total, because the
 * comparison that matters here is composition, not size.
 */

import { formatCurrency, formatNumber, CHANNEL_LABEL } from '@/lib/format';
import type { StoreChannelMix } from '@/lib/queries/dashboard';

const channelLabel = (code: string) => CHANNEL_LABEL[code] ?? code;

/**
 * The grid alone, with no section chrome — shared so the dashboard panel and
 * the Insights finding render the same bars inside their own wrappers rather
 * than maintaining two copies of the same markup.
 */
export function StoreChannelBars({ stores }: { stores: StoreChannelMix[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {stores.map((s) => (
        <div key={s.store} className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-ink">{s.store}</p>
            <p className="tnum text-xs text-ink-muted">{formatCurrency(s.total)}</p>
          </div>
          {s.channels.map((c) => (
            <div key={c.channel}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-ink-2">
                  {channelLabel(c.channel)}
                  <span className="ml-1.5 text-ink-muted">{formatNumber(c.buyers)}</span>
                </span>
                <span className="tnum text-ink-2">
                  {c.share > 0 && c.share < 1 ? '<1' : c.share.toFixed(0)}%
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-accent-soft/50">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.max(0.8, Math.min(100, c.share))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function StoreChannelMixPanel({ stores }: { stores: StoreChannelMix[] }) {
  return (
    <section className="card rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Branch × channel</h2>
      <p className="mt-1 text-sm text-ink-2">
        Each branch&rsquo;s identified revenue, split by where the customer came from.
      </p>
      <div className="mt-5">
        <StoreChannelBars stores={stores} />
      </div>
    </section>
  );
}
