/**
 * Filter bar for the buyer list.
 *
 * A sibling of `filters.tsx`, not a reuse of it: that bar filters *leads*
 * (channel, lifecycle, has-sales), and none of those three mean anything here
 * — every row on this page has already bought, so "has sales" is the page's
 * own definition and "lifecycle" comes back `existing` for all 3,209 of them
 * (see the header of `lib/queries/buyers.ts`). The two controls that replace
 * them, frequency and prior-history, are the splits that actually divide
 * buyers.
 *
 * `useSetParam` is imported rather than re-declared — URL-as-state and the
 * return-to-page-1 rule are shared behaviour, and duplicating them is how the
 * two bars would drift apart. Date and store still belong to
 * `master-filter-bar.tsx` alone (D-82), so Clear never touches them.
 */

'use client';

import { VALUE_TIER_LABEL, formatNumber } from '@/lib/format';
import { useSetParam } from './filters';

const selectClass =
  'rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink transition-shadow ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40';

/** `'none'` is omitted deliberately — a buyer with no purchase is a contradiction. */
const BUYER_TIERS = ['top10', 'next20', 'rest70'] as const;

const SEGMENTS: { value: string; label: string }[] = [
  { value: 'repeat', label: 'Came back (2+ visits)' },
  { value: 'one_time', label: 'One visit only' },
  { value: 'reactivated', label: 'Bought here before' },
  { value: 'net_new', label: 'No prior history' },
];

export function BuyerFilterBar({ total }: { total: number }) {
  const { setParam, params, pending } = useSetParam();

  const active = [params.get('q'), params.get('tier'), params.get('segment')].filter(
    Boolean,
  ).length;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${pending ? 'opacity-70' : ''}`}>
      <input
        type="search"
        defaultValue={params.get('q') ?? ''}
        placeholder="Search buyer name, phone or email"
        onChange={(e) => {
          const value = e.target.value;
          clearTimeout((window as unknown as { __bt?: number }).__bt);
          (window as unknown as { __bt?: number }).__bt = window.setTimeout(
            () => setParam({ q: value || null }),
            350,
          ) as unknown as number;
        }}
        className={`${selectClass} min-w-[16rem] flex-1`}
      />

      <select
        value={params.get('segment') ?? ''}
        onChange={(e) => setParam({ segment: e.target.value || null })}
        className={selectClass}
      >
        <option value="">Every buyer</option>
        {SEGMENTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        value={params.get('tier') ?? ''}
        onChange={(e) => setParam({ tier: e.target.value || null })}
        className={selectClass}
      >
        <option value="">Any value</option>
        {BUYER_TIERS.map((t) => (
          <option key={t} value={t}>
            {VALUE_TIER_LABEL[t]}
          </option>
        ))}
      </select>

      <select
        value={params.get('sort') ?? 'spend'}
        onChange={(e) => setParam({ sort: e.target.value })}
        className={selectClass}
      >
        <option value="spend">Highest spend</option>
        <option value="visits">Most visits</option>
        <option value="recent">Most recent</option>
        <option value="name">Name A–Z</option>
      </select>

      <select
        value={params.get('pageSize') ?? '50'}
        onChange={(e) => setParam({ pageSize: e.target.value })}
        className={selectClass}
      >
        {[25, 50, 100].map((n) => (
          <option key={n} value={n}>
            {n} / page
          </option>
        ))}
      </select>

      <span className="tnum text-sm text-ink-muted">{formatNumber(total)} buyers</span>

      {active > 0 && (
        <button
          type="button"
          onClick={() => setParam({ q: null, tier: null, segment: null })}
          className="rounded-xl px-3 py-2 text-sm font-medium text-accent transition-colors hover:underline active:scale-95"
        >
          Clear {active} filter{active > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
