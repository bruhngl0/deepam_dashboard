/**
 * Data-quality panel.
 *
 * Every figure here silently distorts a KPI if it goes unmentioned. Showing the
 * gaps is what separates a dashboard people trust from one they argue with. (D-56)
 */

import { formatCurrency, formatNumber } from '@/lib/format';
import type { DataQuality } from '@/lib/queries/dashboard';

function Item({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  note: string;
}) {
  return (
    <div>
      <p className="tnum text-xl font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-sm font-medium text-ink">{label}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{note}</p>
    </div>
  );
}

export function DataQualityPanel({ quality }: { quality: DataQuality }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Data quality</h2>
      <p className="mt-1 text-sm text-ink-2">
        Known gaps in this period. Each one moves a number above.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Item
          value={formatCurrency(quality.unmatchedBuyerRevenue)}
          label={`${formatNumber(quality.unmatchedBuyers)} buyers match no lead list`}
          note="They bought, but their number appears on no sheet in the master workbook. Most came through the store directly. This is the ceiling on what lead attribution can ever be shown to explain."
        />
        <Item
          value={formatCurrency(quality.phonelessRevenue)}
          label={`${formatNumber(quality.phonelessBills)} bills with no phone captured`}
          note="Counted in gross revenue but attributable to nobody — they cannot match any lead sheet even in principle. Capturing phone at billing is the fix."
        />
        <Item
          value={`${formatNumber(quality.estimatedTouches)} of ${formatNumber(quality.scopedTouches)}`}
          label="lead touches with an estimated date"
          note="The master workbook carries no dates at all, so the campaign start date stands in for every touch. Time-to-convert is unreliable until a dated export arrives — and it is why channel priority, not timing, decides every overlap between the lists."
        />
        <Item
          value={formatNumber(quality.rejectedUnresolved)}
          label="rows quarantined on import"
          note={
            quality.rejectsByCode.length
              ? quality.rejectsByCode.map((r) => `${r.code} ${r.n}`).join(' · ')
              : 'Nothing outstanding.'
          }
        />
      </div>
    </section>
  );
}
