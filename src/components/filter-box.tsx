/**
 * The one filter box every page uses, placed the same way in every module and app: on the right of the page title,
 * in this order: "Filter" → the page's own filters (department, status, search…) → Store → From → To → Clear.
 * Store and dates are always last, so they sit in the same spot on every page.
 *
 * Module layouts render their filters once (master-filter-bar.tsx, module-filters.tsx); `PlacedFilters` moves them
 * into the page header's <FilterSlot />. A page with no slot gets them in a right-aligned row above its content.
 */

'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const filterBox = 'flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2';
export const filterLabel = 'text-xs text-ink-muted';

/** Where a page header takes the module's filters. Empty (and hidden) on pages without any. */
export function FilterSlot() {
  return <div data-filter-slot="" className="flex min-w-0 flex-col items-end gap-1 empty:hidden" />;
}

const findSlot = () => document.querySelector<HTMLElement>('[data-filter-slot]');
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** The filter box, with an optional line under it saying what the filters narrow. */
export function FilterBox({ children, note, pending }: { children: ReactNode; note?: ReactNode; pending?: boolean }) {
  return (
    <>
      <div role="search" aria-label="Filters" className={`${filterBox} ${pending ? 'opacity-70' : ''}`}>
        <span className="text-xs font-medium text-ink-muted">Filter</span>
        {children}
      </div>
      {note && <p className="max-w-xl text-right text-xs text-ink-muted">{note}</p>}
    </>
  );
}

/** Puts a FilterBox in the page header's slot, or in a right-aligned row when the page has none. */
export function PlacedFilters({ children }: { children: ReactNode }) {
  // null on the server and while hydrating: the box appears once the page header is in place.
  const slot = useSyncExternalStore(subscribe, findSlot, () => undefined);
  if (slot === undefined) return null;
  if (slot) return createPortal(children, slot);
  return (
    <div className="mx-auto flex w-full max-w-[92rem] flex-col items-end gap-1 px-4 pt-6 sm:px-6 lg:px-8">{children}</div>
  );
}
