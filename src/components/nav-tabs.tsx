/**
 * Route tabs.
 *
 * Split out of `site-header.tsx` purely because the active state needs
 * `usePathname`. Keeping this the only client boundary lets the header itself
 * stay a Server Component, so Clerk's `<Show>` can decide server-side whether
 * the tabs render at all — no signed-out flash of navigation.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/insights', label: 'Insights' },
  { href: '/import', label: 'Import' },
] as const;

export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="flex items-center gap-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
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
