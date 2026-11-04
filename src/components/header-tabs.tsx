'use client';

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { HEADER_TABS_SLOT } from './header-slot';

/** The look of a tab in the site header, the same as the route tabs (nav-tabs.tsx). */
export const headerTabClass = (active: boolean) =>
  `shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
    active ? 'bg-inset text-ink' : 'text-ink-2 hover:bg-inset hover:text-ink'
  }`;

const noSubscribe = () => () => {};

/**
 * Section tabs that live in the page's state (the salesperson and store manager desks), shown in the site
 * header. Nothing renders on the server; the tabs appear once the page is in the browser.
 */
export function HeaderTabs<T extends string>({ label, tabs, current, onChange, count }: {
  label: string; tabs: readonly T[]; current: T; onChange: (tab: T) => void; count?: (tab: T) => number | null;
}) {
  const slot = useSyncExternalStore(noSubscribe, () => document.getElementById(HEADER_TABS_SLOT), () => null);
  if (!slot) return null;
  return createPortal(
    <nav aria-label={label} className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {tabs.map(tab => {
        const n = count?.(tab);
        return <button key={tab} type="button" className={headerTabClass(tab === current)} aria-current={tab === current ? 'page' : undefined} onClick={() => onChange(tab)}>
          {tab}{n == null ? '' : ` (${n})`}
        </button>;
      })}
    </nav>,
    slot,
  );
}
