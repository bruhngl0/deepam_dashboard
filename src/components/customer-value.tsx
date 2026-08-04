/**
 * Customer value tiers.
 *
 * The revenue-concentration finding, made actionable. Knowing that a small
 * group carries most of the money is a fact; knowing which channels actually
 * reach that group is a decision. Each tier's bar states its share of
 * identified revenue; the channel line beneath states where those people came
 * from, so "the top decile matters" becomes "the top decile is reachable
 * through these channels, in these proportions."
 *
 * One measure (share of revenue) in one hue, consistent with the rest of the
 * dashboard — the channel mix is set in text rather than a second bar, so the
 * page never needs a categorical palette to tell tiers or channels apart.
 */

import { formatCurrency, formatNumber, CHANNEL_LABEL } from '@/lib/format';
import type { CustomerValueTiers } from '@/lib/queries/dashboard';

const channelLabel = (code: string) => CHANNEL_LABEL[code] ?? code;

export function CustomerValuePanel({ data }: { data: CustomerValueTiers }) {
  const top10 = data.tiers.find((t) => t.tier === 'top10');

  return (
    <section className="card rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Customer value</h2>
      <p className="mt-1 text-sm text-ink-2">
        {formatNumber(top10?.people ?? 0)} customers carry {(top10?.shareOfRevenue ?? 0).toFixed(1)}
        % of identified revenue. Where they came from, below.
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Ranked on lifetime spend, not the selected date range — see the note on{' '}
        <code className="text-[0.7rem]">VALUE_TIER</code> for why.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        {data.tiers.map((t) => (
          <div key={t.tier}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium text-ink">
                {t.label}
                <span className="ml-2 text-xs text-ink-muted">
                  {formatNumber(t.people)} people
                </span>
              </span>
              <span className="tnum text-sm font-semibold text-ink">
                {t.shareOfRevenue.toFixed(1)}%
              </span>
            </div>

            <div
              className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-accent-soft/50"
              role="img"
              aria-label={`${t.label}: ${t.shareOfRevenue.toFixed(1)} percent of identified revenue, ${t.people} people`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong transition-[width] duration-700 ease-out"
                style={{ width: `${Math.max(0.6, Math.min(100, t.shareOfRevenue))}%` }}
              />
            </div>

            <p className="tnum mt-1.5 text-xs text-ink-muted">{formatCurrency(t.revenue)}</p>

            {t.channels.length > 0 && (
              <p className="mt-1 text-xs text-ink-muted">
                {t.channels
                  .map((c) => `${channelLabel(c.channel)} ${c.share.toFixed(0)}%`)
                  .join(' · ')}
                {/* Nobody in this tier has bought anything, so there is no
                    revenue to split — the shares above are of the tier's
                    people instead, and that switch is worth naming. */}
                {t.revenue === 0 && (
                  <span className="ml-1.5 italic text-ink-muted">of these leads</span>
                )}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
