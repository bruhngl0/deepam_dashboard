/**
 * Master filter — date range + store, scoped to the whole CRM module.
 *
 * Lives in `app/crm/layout.tsx`, above every `/crm/*` page, so one control
 * narrows every sales-derived figure on the dashboard, Insights and Analysis
 * at once — the same `from`/`to`/`store` URL params `lib/queries/dashboard.ts`'s
 * `scopeCondition` reads. State lives in the URL (D-82), so a filtered view is
 * shareable and survives navigation between CRM tabs (`nav-tabs.tsx` carries
 * the query string across them). Unset means the full loaded period and every
 * store — nothing narrows until someone actually picks a bound.
 *
 * Hidden on `/crm/import`: nothing on that page reads either param. Owns its
 * own bordered wrapper rather than `layout.tsx` owning one around it, so
 * hiding it there leaves no empty strip behind.
 */

'use client';

import { usePathname } from 'next/navigation';
import { useSetParam } from '@/components/filters';

const selectClass =
  'rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink transition-shadow ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40';

export function MasterFilterBar({
  stores,
  dateBounds,
}: {
  stores: { code: string; name: string }[];
  /** The full loaded range — the `min`/`max` a date picker can't sensibly exceed. */
  dateBounds: { earliest: string | null; latest: string | null };
}) {
  const pathname = usePathname();
  const { setParam, params, pending } = useSetParam();

  if (pathname === '/crm/import') return null;

  const from = params.get('from');
  const to = params.get('to');
  const store = params.get('store');
  const active = [from, to, store].filter(Boolean).length;

  return (
    <div className="border-b border-line bg-surface/60">
      <div
        className={`mx-auto flex w-full max-w-[92rem] flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:px-8 ${pending ? 'opacity-70' : ''}`}
      >
        <span className="text-xs font-medium text-ink-muted">Filter</span>

        <select
          value={store ?? ''}
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

        <div className="flex items-center gap-1.5">
          <label htmlFor="master-date-from" className="text-xs text-ink-muted">
            From
          </label>
          <input
            id="master-date-from"
            type="date"
            value={from ?? ''}
            min={dateBounds.earliest ?? undefined}
            max={to ?? dateBounds.latest ?? undefined}
            onChange={(e) => setParam({ from: e.target.value || null })}
            className={selectClass}
          />
          <label htmlFor="master-date-to" className="text-xs text-ink-muted">
            To
          </label>
          <input
            id="master-date-to"
            type="date"
            value={to ?? ''}
            min={from ?? dateBounds.earliest ?? undefined}
            max={dateBounds.latest ?? undefined}
            onChange={(e) => setParam({ to: e.target.value || null })}
            className={selectClass}
          />
        </div>

        {active > 0 && (
          <button
            type="button"
            onClick={() => setParam({ from: null, to: null, store: null })}
            className="rounded-xl px-3 py-2 text-sm font-medium text-accent transition-colors hover:underline active:scale-95"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
