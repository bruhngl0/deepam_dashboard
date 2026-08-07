/**
 * Insights — what the data says, and what to build next.
 *
 * Every figure is read live from the database (`lib/queries/insights.ts`). The
 * prose states the shape of a finding and its consequence; the numbers inside
 * it are interpolated, so the page cannot quietly go stale the way a written-up
 * analysis does.
 *
 * Charts follow the same idiom as the dashboard: one measure, one hue, bars
 * direct-labelled, no legend. Where two measures disagree — conversion rate
 * against value per sale, which is the entire point of that finding — they go in
 * a table rather than onto a second axis.
 */

import {
  getRevenueConcentration,
  getChannelValue,
  getRepeatPurchase,
  getContactCompleteness,
} from '@/lib/queries/insights';
import { getStoreChannelMix } from '@/lib/queries/dashboard';
import { StoreChannelBars } from '@/components/store-channel-mix';
import { formatCurrency, formatNumber, CHANNEL_LABEL } from '@/lib/format';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const label = (code: string) => CHANNEL_LABEL[code] ?? code;

/**
 * Card wrapper. The eyebrow states the measure; the h2 states the finding.
 * Exported (with `Note` and `Bar` below) so `/analysis` reuses the exact same
 * visual idiom instead of a second copy that can drift from this one.
 */
export function Finding({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card rounded-2xl border border-line bg-surface p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
        {eyebrow}
      </p>
      <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-ink text-balance">
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Interpretation sits below its evidence, in secondary ink. */
export function Note({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[68ch] text-sm leading-relaxed text-ink-2">{children}</p>;
}

/**
 * One measure, one hue. `scale` is the value that fills the track — 100 when the
 * quantity is genuinely a share of a whole, the row maximum when the bars are
 * only being compared with each other.
 */
export function Bar({ value, scale }: { value: number; scale: number }) {
  const pct = scale > 0 ? Math.max(0.8, Math.min(100, (100 * value) / scale)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-accent-soft/50">
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default async function InsightsPage() {
  // Before any query runs — the proxy redirect is not the boundary.
  await requireUser();

  const [deciles, channels, stores, repeat, completeness] = await Promise.all([
    getRevenueConcentration(),
    getChannelValue(),
    getStoreChannelMix(),
    getRepeatPurchase(),
    getContactCompleteness(),
  ]);

  const topDecile = deciles[0];
  const topTwo = deciles.slice(0, 2);
  const topTwoShare = topTwo.reduce((n, d) => n + d.share, 0);
  const topTwoCustomers = topTwo.reduce((n, d) => n + d.customers, 0);
  const bottomHalf = deciles.slice(5);
  const bottomHalfShare = bottomHalf.reduce((n, d) => n + d.share, 0);
  const bottomHalfCustomers = bottomHalf.reduce((n, d) => n + d.customers, 0);
  const maxShare = Math.max(...deciles.map((d) => d.share), 1);

  // Sorted by conversion rate so the disagreement is visible as shape: the rate
  // column descends, the value column does not.
  const acquisition = channels
    .filter((c) => c.channel !== 'existing')
    .sort((a, b) => b.conversionRate - a.conversionRate);
  const bestRate = [...acquisition].sort((a, b) => b.conversionRate - a.conversionRate)[0];
  const bestValue = [...acquisition].sort((a, b) => b.revenuePerBuyer - a.revenuePerBuyer)[0];

  const repeaters = repeat.filter((r) => r.bills > 1);
  const repeatCustomers = repeaters.reduce((n, r) => n + r.customers, 0);
  const totalBuyers = repeat.reduce((n, r) => n + r.customers, 0);
  const mostBills = repeat.length ? repeat[repeat.length - 1].bills : 0;
  const maxRepeat = Math.max(...repeat.map((r) => r.customers), 1);

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Insights</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
          What the current data supports, and what to build next. Every figure is read live
          from the database, so this page moves when the data does.
        </p>
      </header>

      {/* ── Findings ─────────────────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Finding
          eyebrow="Revenue concentration"
          title={`${formatNumber(topDecile?.customers ?? 0)} customers carry ${(topDecile?.share ?? 0).toFixed(1)}% of the revenue`}
        >
          <div className="flex flex-col gap-2.5">
            {deciles.map((d) => (
              <div key={d.decile}>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-ink">
                    {d.decile === 1 ? 'Top 10%' : `${(d.decile - 1) * 10}–${d.decile * 10}%`}
                    <span className="ml-2 text-xs text-ink-muted">
                      {formatNumber(d.customers)} buyers
                    </span>
                  </span>
                  <span className="tnum font-semibold text-ink">{d.share.toFixed(1)}%</span>
                </div>
                <div className="mt-1.5">
                  <Bar value={d.share} scale={maxShare} />
                </div>
                <p className="tnum mt-1 text-xs text-ink-muted">{formatCurrency(d.revenue)}</p>
              </div>
            ))}
          </div>
          <Note>
            The top fifth — {formatNumber(topTwoCustomers)} people — is{' '}
            {topTwoShare.toFixed(1)}% of all matched revenue, while the bottom half (
            {formatNumber(bottomHalfCustomers)} buyers) is {bottomHalfShare.toFixed(1)}%. The
            dashboard is built almost entirely around volume: lead counts and conversion
            rates. In a business shaped like this, whether a channel converts at 1.3% or 2.5%
            matters far less than whether it reached any of the top{' '}
            {formatNumber(topDecile?.customers ?? 0)}. There is currently no view that answers
            who they are or where they came from. Bars are scaled to the largest decile.
          </Note>
        </Finding>

        <div className="flex flex-col gap-3">
          <Finding
            eyebrow="Conversion against value"
            title="The channel that converts best is worth the least per sale"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                    <th className="pb-2 text-left font-bold">Channel</th>
                    <th className="pb-2 text-right font-bold">Conv. rate</th>
                    <th className="pb-2 text-right font-bold">Avg bill</th>
                    <th className="pb-2 text-right font-bold">Per buyer</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisition.map((c) => (
                    <tr key={c.channel} className="border-t border-grid align-baseline">
                      <td className="py-2 pr-4 text-ink">{label(c.channel)}</td>
                      <td className="tnum py-2 text-right text-ink-2">
                        {c.conversionRate.toFixed(2)}%
                      </td>
                      <td className="tnum py-2 text-right text-ink-2">
                        {formatCurrency(c.averageBill)}
                      </td>
                      <td className="tnum py-2 text-right font-medium text-ink">
                        {formatCurrency(c.revenuePerBuyer)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>
              {label(bestRate?.channel ?? '')} converts highest at{' '}
              {(bestRate?.conversionRate ?? 0).toFixed(2)}%, and its buyers are worth{' '}
              {formatCurrency(bestRate?.revenuePerBuyer ?? 0)} each — against{' '}
              {formatCurrency(bestValue?.revenuePerBuyer ?? 0)} for{' '}
              {label(bestValue?.channel ?? '')}. Read the rate column alone and you move budget
              the wrong way. The dashboard shows revenue per <em>lead</em> on the campaign
              table but never value per sale, which is the number a retailer runs on.
            </Note>
          </Finding>

          <Finding
            eyebrow="Branch mix"
            title="The two branches are running different businesses"
          >
            <StoreChannelBars stores={stores} />
            <Note>
              One branch runs on people who already knew you; the other runs on acquisition —
              a real operational difference in staffing and campaign spend. This finding now
              has a permanent home: the Branch × channel panel on the dashboard, which reads
              the same query as the bars above.
            </Note>
          </Finding>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Finding
          eyebrow="Repeat purchase"
          title={`${formatNumber(repeatCustomers)} customers bought more than once in the loaded period`}
        >
          <div className="flex flex-col gap-2.5">
            {repeat.map((r) => (
              <div key={r.bills}>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-ink">
                    {r.bills} {r.bills === 1 ? 'bill' : 'bills'}
                  </span>
                  <span className="tnum text-ink-2">
                    {formatNumber(r.customers)} customers · {formatCurrency(r.revenue)}
                  </span>
                </div>
                <div className="mt-1.5">
                  <Bar value={r.customers} scale={maxRepeat} />
                </div>
              </div>
            ))}
          </div>
          <Note>
            That is {((100 * repeatCustomers) / (totalBuyers || 1)).toFixed(0)}% of buyers
            returning inside a single week, one of them {mostBills} times. Either the festival
            week really is that intense, or some of these are exchanges and returns booked as
            separate bills. Every one of them currently counts as fresh revenue — worth
            confirming against the POS before anyone quotes a repeat rate.
          </Note>
        </Finding>

        <Finding
          eyebrow="What we know about people"
          title="Contact data will not support CRM features yet"
        >
          <div className="flex flex-col gap-3">
            {completeness.fields.map((f) => (
              <div key={f.field}>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-ink">{f.field}</span>
                  <span className="tnum font-semibold text-ink">{f.share.toFixed(1)}%</span>
                </div>
                <div className="mt-1.5">
                  <Bar value={f.share} scale={100} />
                </div>
                <p className="tnum mt-1 text-xs text-ink-muted">
                  {formatNumber(f.missing)} of {formatNumber(completeness.total)} customers
                </p>
              </div>
            ))}
          </div>
          <Note>
            Birthday campaigns, area segmentation and email flows are all commonly asked for
            and none is viable on this data. Worth knowing before any of them gets scoped. The
            gap is structural, not an import bug: the WhatsApp sheet carries no name column at
            all, and nothing in the current pipeline ever collects a date of birth.
          </Note>
        </Finding>
      </div>

      {/* ── Roadmap ──────────────────────────────────────────────────────── */}
      <Roadmap />
    </main>
  );
}

const PUSHBACK: { title: string; body: string }[] = [
  {
    title: 'More conversion-rate charts',
    body:
      'There are already four on the dashboard. The business is not conversion-limited, it is concentration-limited — the same effort spent on customer value would tell you more.',
  },
  {
    title: 'Treating the channel rates as proof',
    body:
      'Others converts high because it is store-sourced: those are people who walked in. That is selection, not performance. And WhatsApp has no baseline — without a holdout group you cannot separate "the broadcast worked a little" from "these people would have bought anyway". Holding back 10% of the next broadcast list would settle it, and would be worth more than any chart on this page.',
  },
];

function Roadmap() {
  return (
    <section className="card mt-3 rounded-2xl border border-line bg-surface p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
        What I would push back on
      </p>
      <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-ink">
        Two things worth not building
      </h2>

      <div className="mt-5 flex flex-col gap-5">
        {PUSHBACK.map((item) => (
          <div key={item.title} className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
            <p className="max-w-[68ch] text-sm leading-relaxed text-ink-2">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
