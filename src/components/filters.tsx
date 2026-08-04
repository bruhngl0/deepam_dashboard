/**
 * Filter bar and pagination.
 *
 * Every control composes and nothing resets silently — a filter that clears
 * another is how someone ends up quoting a number for the wrong segment. State
 * lives in the URL, so a filtered view is shareable and the back button works. (D-82)
 *
 * From/To bounds every sales-derived figure on the page, not just this table —
 * `page.tsx` passes the same range into every dashboard query. Nothing here
 * defaults to a narrowed window: unset means the full loaded period, so today's
 * numbers do not change until someone actually picks a date.
 */

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { CHANNEL_LABEL, VALUE_TIER_LABEL, VALUE_TIER_ORDER, formatNumber } from '@/lib/format';

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
  'rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink transition-shadow ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40';

export function FilterBar({
  stores,
  channels,
  dateBounds,
}: {
  stores: { code: string; name: string }[];
  channels: string[];
  /** The full loaded range — the `min`/`max` a date picker can't sensibly exceed. */
  dateBounds: { earliest: string | null; latest: string | null };
}) {
  const { setParam, params, pending } = useSetParam();

  const active = [
    params.get('q'),
    params.get('store'),
    params.get('channel'),
    params.get('lifecycle'),
    params.get('hasSales'),
    params.get('tier'),
    params.get('from'),
    params.get('to'),
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
        value={params.get('tier') ?? ''}
        onChange={(e) => setParam({ tier: e.target.value || null })}
        className={selectClass}
      >
        <option value="">Any value</option>
        {VALUE_TIER_ORDER.map((t) => (
          <option key={t} value={t}>
            {VALUE_TIER_LABEL[t]}
          </option>
        ))}
      </select>

      {/* Bounds sales, not leads — narrows bill counts, revenue and the
          converted flag to this window. Leads have no date to narrow (D-84),
          so a range here never changes who is listed, only what they're
          shown to have bought. */}
      <div className="flex items-center gap-1.5">
        <label htmlFor="date-from" className="text-xs text-ink-muted">
          From
        </label>
        <input
          id="date-from"
          type="date"
          value={params.get('from') ?? ''}
          min={dateBounds.earliest ?? undefined}
          max={params.get('to') ?? dateBounds.latest ?? undefined}
          onChange={(e) => setParam({ from: e.target.value || null })}
          className={selectClass}
        />
        <label htmlFor="date-to" className="text-xs text-ink-muted">
          To
        </label>
        <input
          id="date-to"
          type="date"
          value={params.get('to') ?? ''}
          min={params.get('from') ?? dateBounds.earliest ?? undefined}
          max={dateBounds.latest ?? undefined}
          onChange={(e) => setParam({ to: e.target.value || null })}
          className={selectClass}
        />
      </div>

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

      {/* Every filter above, minus page/pageSize — export has no pages. A
          plain navigation link, not a fetch: the browser's own download
          handling is simpler and more reliable than reimplementing it. */}
      <a
        href={`/api/customers/export?${(() => {
          const p = new URLSearchParams(params.toString());
          p.delete('page');
          p.delete('pageSize');
          return p.toString();
        })()}`}
        className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-2 shadow-sm transition-colors hover:bg-inset hover:text-ink active:scale-95"
      >
        Export CSV
      </a>

      {active > 0 && (
        <button
          type="button"
          onClick={() =>
            setParam({
              q: null,
              store: null,
              channel: null,
              lifecycle: null,
              hasSales: null,
              tier: null,
              from: null,
              to: null,
            })
          }
          className="rounded-xl px-3 py-2 text-sm font-medium text-accent transition-colors hover:underline active:scale-95"
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
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors disabled:opacity-40 enabled:hover:bg-inset enabled:active:scale-95"
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
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors disabled:opacity-40 enabled:hover:bg-inset enabled:active:scale-95"
        >
          Next
        </button>
      </div>
    </div>
  );
}
