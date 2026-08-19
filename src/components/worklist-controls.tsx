/**
 * Filters for a worklist.
 *
 * Reuses `useSetParam` from `filters.tsx` for the same reason
 * `buyer-filters.tsx` does — URL-as-state and the reset-to-page-1 rule are
 * shared behaviour, and a second copy would drift.
 *
 * The score threshold is a select of round numbers rather than a slider: the
 * score is a percentile-derived hypothesis, and a control that invites
 * dragging to "83" implies a precision it does not have.
 */

'use client';

import { formatNumber } from '@/lib/format';
import { useSetParam } from './filters';
import type { ListKind } from '@/lib/queries/worklist';

const selectClass =
  'rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink transition-shadow ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40';

export function WorklistControls({ listKind, total }: { listKind: ListKind; total: number }) {
  const { setParam, params, pending } = useSetParam();
  const includeContacted = params.get('includeContacted') === 'yes';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${pending ? 'opacity-70' : ''}`}>
      <input
        type="search"
        defaultValue={params.get('q') ?? ''}
        placeholder="Search name or phone"
        onChange={(e) => {
          const value = e.target.value;
          clearTimeout((window as unknown as { __wl?: number }).__wl);
          (window as unknown as { __wl?: number }).__wl = window.setTimeout(
            () => setParam({ q: value || null }),
            350,
          ) as unknown as number;
        }}
        className={`${selectClass} min-w-[14rem] flex-1`}
      />

      <select
        value={params.get('minScore') ?? ''}
        onChange={(e) => setParam({ minScore: e.target.value || null })}
        className={selectClass}
      >
        <option value="">Any score</option>
        {[60, 70, 80, 90].map((n) => (
          <option key={n} value={n}>
            Score {n}+
          </option>
        ))}
      </select>

      <select
        value={params.get('pageSize') ?? '25'}
        onChange={(e) => setParam({ pageSize: e.target.value })}
        className={selectClass}
      >
        {[25, 50, 100].map((n) => (
          <option key={n} value={n}>
            {n} / page
          </option>
        ))}
      </select>

      <label className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-2">
        <input
          type="checkbox"
          checked={includeContacted}
          onChange={(e) => setParam({ includeContacted: e.target.checked ? 'yes' : null })}
          className="accent-accent"
        />
        Include already contacted
      </label>

      <span className="tnum text-sm text-ink-muted">
        {formatNumber(total)} {listKind === 'reactivation' ? 'to win back' : 'in window'}
      </span>
    </div>
  );
}
