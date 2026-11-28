/**
 * One filter box for a whole module (HR Intelligence, Ananta Partner Network), on the right of every page's title
 * (components/filter-box.tsx), always in the same order: the page's own filters (department, status…, search) →
 * Store → period (From/To, or Month on monthly pages) → Clear. Each page says which of these it uses in `pages`; a page not listed shows no strip.
 *
 * State lives in the URL like the CRM master filter (`from`, `to`, `store`, `month`, plus each field's param), so a
 * filtered view is shareable and `from`/`to`/`store` carry across the module's tabs (nav-tabs.tsx). Unset means the
 * page's default (each page names it in `note`).
 */

'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSetParam } from '@/components/filters';
import { StoreMultiSelect } from '@/components/store-multi-select';
import { control, textButton } from '@/components/ui';
import { storeCodes } from '@/lib/store-filter';
import { FilterBox, filterLabel, PlacedFilters } from '@/components/filter-box';

export type FilterField =
  | { kind: 'select'; param: string; label: string; all: string; options: { value: string; label: string }[] }
  | { kind: 'search'; param: string; placeholder: string };

export type FilterPage = {
  /** The page's path. With `prefix`, pages under it too; with `pattern` (a RegExp source), any path matching it. */
  path: string;
  prefix?: boolean;
  pattern?: string;
  /** Show the store picker; `stores` narrows its list for this page. */
  store?: boolean;
  stores?: { code: string; name: string }[];
  period?: 'range' | 'month';
  /** Label for the period inputs, e.g. "Joined" or "Registered". */
  periodLabel?: string;
  fields?: FilterField[];
  /** What the filters narrow on this page, and the default when nothing is picked. */
  note?: string;
};

function matches(page: FilterPage, pathname: string) {
  if (page.pattern) return new RegExp(page.pattern).test(pathname);
  return pathname === page.path || (!!page.prefix && pathname.startsWith(`${page.path}/`));
}

function SearchBox({ param, placeholder, value, onSearch }: { param: string; placeholder: string; value: string; onSearch: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) { setSeen(value); setText(value); }
  // Searches once typing pauses, so each keystroke doesn't reload the page.
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onSearch(text.trim()), 450);
    return () => clearTimeout(t);
  }, [text, value, onSearch]);
  return (
    <input type="search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSearch(text.trim()); }}
      placeholder={placeholder} aria-label={placeholder} name={param} className={`${control} w-full sm:w-64`} />
  );
}

export function ModuleFilters({ pages, stores, dateBounds, thisMonth }: {
  pages: FilterPage[];
  stores: { code: string; name: string }[];
  dateBounds?: { earliest: string | null; latest: string | null };
  /** The current month (YYYY-MM), the latest a month picker offers. */
  thisMonth: string;
}) {
  const pathname = usePathname();
  const { setParam, params, pending } = useSetParam();
  const page = pages.find((p) => matches(p, pathname));
  if (!page) return null;

  const from = params.get('from');
  const to = params.get('to');
  const month = params.get('month');
  const store = params.get('store');
  const fields = page.fields ?? [];
  const keys = ['store', 'from', 'to', 'month', ...fields.map((f) => f.param)];
  const active = keys.some((k) => params.get(k));
  const clear = () => setParam(Object.fromEntries(keys.map((k) => [k, null])));
  const label = page.periodLabel ? `${page.periodLabel} ` : '';

  return (
    <PlacedFilters>
      <FilterBox pending={pending} note={page.note}>
        {fields.map((f) => f.kind === 'select' ? (
          <label key={f.param} className={`flex items-center gap-1.5 ${filterLabel}`}>
            {f.label}
            <select value={params.get(f.param) ?? ''} onChange={(e) => setParam({ [f.param]: e.target.value || null })} className={control}>
              <option value="">{f.all}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ) : (
          <SearchBox key={f.param} param={f.param} placeholder={f.placeholder} value={params.get(f.param) ?? ''} onSearch={(v) => setParam({ [f.param]: v || null })} />
        ))}

        {page.store && (
          <StoreMultiSelect stores={page.stores ?? stores} value={storeCodes(store)} className={control}
            onChange={(codes) => setParam({ store: codes.length ? codes.join(',') : null })} />
        )}

        {page.period === 'range' && (<>
          <label htmlFor="mf-from" className={filterLabel}>{label}From</label>
          <input id="mf-from" type="date" value={from ?? ''} min={dateBounds?.earliest ?? undefined} max={to ?? dateBounds?.latest ?? undefined}
            onChange={(e) => setParam({ from: e.target.value || null })} className={control} />
          <label htmlFor="mf-to" className={filterLabel}>To</label>
          <input id="mf-to" type="date" value={to ?? ''} min={from ?? dateBounds?.earliest ?? undefined} max={dateBounds?.latest ?? undefined}
            onChange={(e) => setParam({ to: e.target.value || null })} className={control} />
        </>)}

        {page.period === 'month' && (<>
          <label htmlFor="mf-month" className={filterLabel}>{label}Month</label>
          <input id="mf-month" type="month" value={month ?? ''} max={thisMonth} onChange={(e) => setParam({ month: e.target.value || null })} className={control} />
        </>)}

        {active && <button type="button" onClick={clear} className={textButton}>Clear</button>}
      </FilterBox>
    </PlacedFilters>
  );
}
