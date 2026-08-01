/**
 * Filter bar and pagination.
 *
 * Every control composes and nothing resets silently — a filter that clears
 * another is how someone ends up quoting a number for the wrong segment. State
 * lives in the URL, so a filtered view is shareable and the back button works. (D-82)
 */

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { CHANNEL_LABEL, formatNumber } from '@/lib/format';

function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      // Any filter change returns to page 1; staying on page 7 of a now-shorter
      // result set shows an empty table for no visible reason.
      if (!('page' in updates)) next.delete('page');
      startTransition(() => router.push(`${pathname}?${next.toString()}`));
    },
    [params, pathname, router],
  );

  return { setParam, params, pending };
}

const selectClass =
  'rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40';

export function FilterBar({
  stores,
  channels,
}: {
  stores: { code: string; name: string }[];
  channels: string[];
}) {
  const { setParam, params, pending } = useSetParam();

  const active = [
    params.get('q'),
    params.get('store'),
    params.get('channel'),
    params.get('lifecycle'),
    params.get('hasSales'),
  ].filter(Boolean).length;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${pending ? 'opacity-70' : ''}`}>
      <input
        type="search"
        defaultValue={params.get('q') ?? ''}
        placeholder="Search name, phone, email or city"
        onChange={(e) => {
          const value = e.target.value;
          // Debounce so a query does not fire on every keystroke.
          clearTimeout((window as unknown as { __t?: number }).__t);
          (window as unknown as { __t?: number }).__t = window.setTimeout(
            () => setParam({ q: value || null }),
            350,
          ) as unknown as number;
        }}
        className={`${selectClass} min-w-[16rem] flex-1`}
      />

      <select
        value={params.get('store') ?? ''}
        onChange={(e) => setParam({ store: e.target.value || null })}
        className={selectClass}
      >
        <option value="">All stores</option>
        {stores.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        value={params.get('channel') ?? ''}
        onChange={(e) => setParam({ channel: e.target.value || null })}
        className={selectClass}
      >
        <option value="">All channels</option>
        {channels.map((c) => (
          <option key={c} value={c}>
            {CHANNEL_LABEL[c] ?? c}
          </option>
        ))}
      </select>

      <select
        value={params.get('lifecycle') ?? ''}
        onChange={(e) => setParam({ lifecycle: e.target.value || null })}
        className={selectClass}
      >
        <option value="">New &amp; existing</option>
        <option value="new">New only</option>
        <option value="existing">Existing only</option>
      </select>

      <select
        value={params.get('hasSales') ?? ''}
        onChange={(e) => setParam({ hasSales: e.target.value || null })}
        className={selectClass}
      >
        <option value="">Any purchase</option>
        <option value="yes">Has sales</option>
        <option value="no">No sales</option>
      </select>

      <select
        value={params.get('sort') ?? 'sales'}
        onChange={(e) => setParam({ sort: e.target.value })}
        className={selectClass}
      >
        <option value="sales">Highest sales</option>
        <option value="recent">Most recent</option>
        <option value="name">Name A–Z</option>
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

      {active > 0 && (
        <button
          type="button"
          onClick={() =>
            setParam({ q: null, store: null, channel: null, lifecycle: null, hasSales: null })
          }
          className="rounded-xl px-3 py-2 text-sm font-medium text-accent hover:underline"
        >
          Clear {active} filter{active > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}) {
  const { setParam } = useSetParam();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-grid px-4 py-3">
      <p className="tnum text-sm text-ink-2">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setParam({ page: String(page - 1) })}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 disabled:opacity-40 enabled:hover:bg-inset"
        >
          Previous
        </button>
        <span className="tnum text-sm text-ink-2">
          Page {formatNumber(page)} of {formatNumber(pageCount)}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => setParam({ page: String(page + 1) })}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 disabled:opacity-40 enabled:hover:bg-inset"
        >
          Next
        </button>
      </div>
    </div>
  );
}
