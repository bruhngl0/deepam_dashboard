/**
 * Site header — brand, route tabs, theme toggle.
 *
 * Lives in the root layout so it renders once and survives navigation between
 * Home and Insights rather than being rebuilt per page.
 *
 * A Client Component only because the active tab depends on `usePathname`. It
 * holds no data, so nothing about the dashboard's server rendering changes.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/insights', label: 'Insights' },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-page/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[92rem] items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          Deepam CRM
        </Link>

        <nav aria-label="Sections" className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  active
                    ? 'bg-inset text-ink'
                    : 'text-ink-2 hover:bg-inset hover:text-ink'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
