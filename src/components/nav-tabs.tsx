/**
 * Route tabs, scoped by module.
 *
 * Split out of `site-header.tsx` purely because the active state needs
 * `usePathname`. Keeping this the only client boundary lets the header itself
 * stay a Server Component, so Clerk's `<Show>` can decide server-side whether
 * the tabs render at all — no signed-out flash of navigation.
 *
 * The hero page (`/`) picks between two independent modules, so it shows no
 * tabs of its own; `/crm/*` and `/vendor/*` each get their own scoped set
 * rather than one flat list that doesn't make sense outside its module.
 *
 * The CRM tabs carry the master date/store filter (`from`/`to`/`store`, see
 * `master-filter-bar.tsx`) across navigation — switching from Dashboard to
 * Insights should not silently drop the window someone just picked. Only
 * those three keys travel; page-specific state like the customer table's
 * search text has no meaning on another page and is left behind.
 */

'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const CARRIED_PARAMS = ['from', 'to', 'store'];

const CRM_TABS = [
  { href: '/crm', label: 'Home' },
  { href: '/crm/buyers', label: 'Buyers' },
  { href: '/crm/insights', label: 'Insights' },
  { href: '/crm/analysis', label: 'Analysis' },
  { href: '/crm/import', label: 'Import' },
] as const;

const VENDOR_TABS = [
  { href: '/vendor', label: 'Dashboard' },
  { href: '/vendor/import', label: 'Import' },
] as const;

export function NavTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabs = pathname.startsWith('/crm')
    ? CRM_TABS
    : pathname.startsWith('/vendor')
      ? VENDOR_TABS
      : null;

  if (!tabs) return null;

  const carried = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = searchParams.get(key);
    if (value) carried.set(key, value);
  }
  const suffix = carried.toString() ? `?${carried.toString()}` : '';

  return (
    <nav aria-label="Sections" className="flex items-center gap-1">
      {tabs.map((tab) => {
        // A detail route under a tab still belongs to that tab — `/crm/buyers/91`
        // must keep Buyers lit. Exact match alone would drop the highlight the
        // moment someone opened a profile. The module roots (`/crm`, `/vendor`)
        // are matched exactly on purpose: prefix-matching them would light
        // every tab at once.
        const active =
          pathname === tab.href ||
          (tab.href !== '/crm' && tab.href !== '/vendor' && pathname.startsWith(`${tab.href}/`));
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${suffix}`}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              active ? 'bg-inset text-ink' : 'text-ink-2 hover:bg-inset hover:text-ink'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
