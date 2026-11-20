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
 * Also used above `/vendor/*` (app/vendor/layout.tsx), where `notes` says per page what the filters narrow,
 * and above HR Intelligence's Salespeople pages (app/hr/layout.tsx, with `onlyUnder`).
 *
 * Hidden on the import pages: nothing on them reads either param. Shown in the page header's filter slot, on the
 * right of the title (components/filter-box.tsx), like every filter in every app.
 */

'use client';

import { usePathname } from 'next/navigation';
import { useSetParam } from '@/components/filters';
import { control, textButton } from '@/components/ui';
import { StoreMultiSelect } from '@/components/store-multi-select';
import { storeCodes } from '@/lib/store-filter';
import { FilterBox, filterLabel, PlacedFilters } from '@/components/filter-box';

const selectClass = control;

export function MasterFilterBar({
  stores,
  dateBounds,
  notes = {},
  onlyUnder,
}: {
  stores: { code: string; name: string }[];
  /** The full loaded range — the `min`/`max` a date picker can't sensibly exceed. */
  dateBounds: { earliest: string | null; latest: string | null };
  /** A short line shown after the controls on the page with this pathname. */
  notes?: Record<string, string>;
  /** Show the bar only on this path and the pages under it. */
  onlyUnder?: string;
}) {
  const pathname = usePathname();
  const { setParam, params, pending } = useSetParam();

  if (pathname.endsWith('/import')) return null;
  if (onlyUnder && pathname !== onlyUnder && !pathname.startsWith(`${onlyUnder}/`)) return null;

  const from = params.get('from');
  const to = params.get('to');
  const store = params.get('store');
  const active = [from, to, store].filter(Boolean).length;

  return (
    <PlacedFilters>
      <FilterBox pending={pending} note={notes[pathname]}>
        <StoreMultiSelect stores={stores} value={storeCodes(store)} onChange={(codes) => setParam({ store: codes.length ? codes.join(',') : null })} className={selectClass} />
        <label htmlFor="master-date-from" className={filterLabel}>From</label>
        <input id="master-date-from" type="date" value={from ?? ''} min={dateBounds.earliest ?? undefined} max={to ?? dateBounds.latest ?? undefined}
          onChange={(e) => setParam({ from: e.target.value || null })} className={selectClass} />
        <label htmlFor="master-date-to" className={filterLabel}>To</label>
        <input id="master-date-to" type="date" value={to ?? ''} min={from ?? dateBounds.earliest ?? undefined} max={dateBounds.latest ?? undefined}
          onChange={(e) => setParam({ to: e.target.value || null })} className={selectClass} />
        {active > 0 && <button type="button" onClick={() => setParam({ from: null, to: null, store: null })} className={textButton}>Clear</button>}
      </FilterBox>
    </PlacedFilters>
  );
}
