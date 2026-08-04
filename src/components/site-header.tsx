/**
 * Site header — brand, route tabs, theme toggle, account menu.
 *
 * Lives in the root layout so it renders once and survives navigation between
 * Home and Insights rather than being rebuilt per page.
 *
 * A Server Component. Clerk Core 3 replaced `<SignedIn>` with `<Show>`, which
 * resolves server-side, so the signed-out header renders correctly on the first
 * paint instead of briefly showing navigation the visitor cannot use. The tabs
 * are a client child (`nav-tabs.tsx`) only because the active state needs
 * `usePathname`.
 */

import Link from 'next/link';
import { Show, UserButton } from '@clerk/nextjs';
import { NavTabs } from '@/components/nav-tabs';
import { ThemeToggle } from '@/components/theme-toggle';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-page/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[92rem] items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="group flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-strong text-[13px] font-semibold text-white shadow-sm transition-transform group-hover:scale-105">
            D
          </span>
          <span className="text-base font-semibold tracking-tight text-ink">Deepam CRM</span>
        </Link>

        {/* Tabs are useless signed out — every destination redirects back. */}
        <Show when="signed-in">
          <NavTabs />
        </Show>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <Show when="signed-in">
            <UserButton appearance={{ elements: { avatarBox: 'size-8' } }} />
          </Show>
        </div>
      </div>
    </header>
  );
}
