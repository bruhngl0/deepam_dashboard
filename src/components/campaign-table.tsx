/**
 * Campaign breakdown.
 *
 * Revenue per lead is the column that changes decisions — conversion rate alone
 * rewards a campaign that brings many small buyers over one that brings few
 * large ones. Sorted by revenue so the ranking matches the money.
 */

import { formatNumber, formatCurrency, CHANNEL_LABEL } from '@/lib/format';
import type { CampaignRow } from '@/lib/queries/dashboard';

export function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight text-ink">By campaign</h2>
      <p className="mt-1 text-sm text-ink-2">
        Each campaign&rsquo;s share of the exclusive first-touch split.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.09em] text-ink-muted">
              <th className="pb-2 text-left font-medium">Campaign</th>
              <th className="pb-2 text-right font-medium">Leads</th>
              <th className="pb-2 text-right font-medium">Bought</th>
              <th className="pb-2 text-right font-medium">Rate</th>
              <th className="pb-2 text-right font-medium">Revenue</th>
              <th className="pb-2 text-right font-medium">Per lead</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.channel}-${r.name}`} className="border-t border-grid">
                <td className="py-2.5 text-ink">
                  {r.name}
                  <span className="ml-2 text-xs text-ink-muted">
                    {CHANNEL_LABEL[r.channel] ?? r.channel}
                  </span>
                </td>
                <td className="tnum py-2.5 text-right text-ink-2">
                  {formatNumber(r.people)}
                </td>
                <td className="tnum py-2.5 text-right text-ink-2">
                  {formatNumber(r.buyers)}
                </td>
                <td className="tnum py-2.5 text-right text-ink-2">
                  {r.conversionRate.toFixed(2)}%
                </td>
                <td className="tnum py-2.5 text-right font-medium text-ink">
                  {formatCurrency(r.revenue)}
                </td>
                <td className="tnum py-2.5 text-right text-ink-2">
                  {formatCurrency(r.revenuePerLead)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
