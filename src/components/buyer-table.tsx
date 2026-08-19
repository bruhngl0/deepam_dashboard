/**
 * Buyer list table.
 *
 * Visits and bills are shown as one cell, `3 visits · 5 bills`, rather than a
 * single "orders" number. They are genuinely different quantities here — of
 * the 871 consecutive bill-pairs in the book, 573 are same-day splits — and a
 * table that showed only one of them would either flatter the repeat rate
 * (bills) or hide that a trip generated four vouchers (visits). Where the two
 * agree, the second half is dropped so the common case stays quiet.
 *
 * A Server Component: nothing here holds state. The whole row is a link
 * target via the name cell, and the tier/history chips are the two facts worth
 * scanning down a column for.
 */

import Link from 'next/link';
import {
  formatCurrency,
  formatNumber,
  formatPhone,
  formatDate,
  orNotProvided,
  CHANNEL_LABEL,
  VALUE_TIER_LABEL,
} from '@/lib/format';
import type { BuyerListRow } from '@/lib/queries/buyers';

const TIER_TONE: Record<string, string> = {
  top10: 'bg-accent-soft/50 text-ink border-transparent',
  next20: 'bg-inset text-ink-2 border-line',
  rest70: 'bg-transparent text-ink-muted border-line',
};

function Chip({
  children,
  className = 'bg-inset text-ink-2 border-line',
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export function BuyerTable({ rows }: { rows: BuyerListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-10 text-center">
        <p className="text-sm text-ink-2">No buyer matches these filters.</p>
        <p className="mt-1 text-xs text-ink-muted">
          The date and store window at the top of the page narrows this list too — a buyer with
          no bill inside it will not appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[64rem] border-collapse text-left">
        <thead>
          <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
            <th className="px-4 py-3 font-bold">Buyer</th>
            <th className="px-4 py-3 font-bold">Store</th>
            <th className="px-4 py-3 font-bold">Frequency</th>
            <th className="px-4 py-3 text-right font-bold">Units</th>
            <th className="px-4 py-3 text-right font-bold">Total spend</th>
            <th className="px-4 py-3 text-right font-bold">Avg bill</th>
            <th className="px-4 py-3 font-bold">Last purchase</th>
            <th className="px-4 py-3 font-bold">History</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-grid transition-colors hover:bg-inset/60">
              <td className="px-4 py-3">
                <Link
                  href={`/crm/buyers/${r.id}`}
                  className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {orNotProvided(r.fullName)}
                </Link>
                <p className="tnum text-xs text-ink-muted">{formatPhone(r.phoneE164)}</p>
              </td>

              <td className="px-4 py-3">
                {r.storeName ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <Chip>{r.storeName}</Chip>
                    {r.storeCount > 1 && (
                      <Chip title="Bought at more than one branch">+{r.storeCount - 1}</Chip>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-ink-muted">Not provided</span>
                )}
              </td>

              <td className="tnum px-4 py-3 text-sm text-ink">
                {formatNumber(r.visits)} visit{r.visits === 1 ? '' : 's'}
                {r.bills !== r.visits && (
                  <span className="text-ink-muted"> · {formatNumber(r.bills)} bills</span>
                )}
              </td>

              <td className="tnum px-4 py-3 text-right text-sm text-ink-2">
                {formatNumber(r.units)}
              </td>

              <td className="px-4 py-3 text-right">
                <p className="tnum text-sm font-medium text-ink">{formatCurrency(r.totalSpend)}</p>
                <p className="mt-0.5">
                  <Chip className={TIER_TONE[r.valueTier] ?? TIER_TONE.rest70}>
                    {VALUE_TIER_LABEL[r.valueTier]}
                  </Chip>
                </p>
              </td>

              <td className="tnum px-4 py-3 text-right text-sm text-ink-2">
                {formatCurrency(r.avgBill)}
              </td>

              <td className="px-4 py-3 text-sm text-ink-2">{formatDate(r.lastPurchase)}</td>

              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {r.hasPriorHistory && (
                    <Chip
                      className="bg-accent-soft/40 text-ink border-transparent"
                      title={`${formatNumber(r.priorBills)} bills on record before this sales window`}
                    >
                      Returning
                    </Chip>
                  )}
                  {r.channels.map((c) => (
                    <Chip key={c}>{CHANNEL_LABEL[c] ?? c}</Chip>
                  ))}
                  {!r.hasPriorHistory && r.channels.length === 0 && (
                    <span className="text-xs text-ink-muted">No prior record</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
