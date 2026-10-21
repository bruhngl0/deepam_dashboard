/**
 * Hero — module picker.
 *
 * The modules behind this app: the cross-module Overview (`/flow`), the Daily
 * dashboard (`/daily`), Reports (`/reports`), Customer
 * Intelligence (`/crm`), Vendor Intelligence (`/vendor`), the external Driver
 * Network Management and Store Performance Tracker services, and Marketing
 * Intelligence (`/marketing`). This page is just the door between them, not
 * a dashboard of its own, so `NavTabs` shows nothing here (see
 * `components/nav-tabs.tsx`).
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';

export default async function HeroPage() {
  // Before any query runs — the proxy redirect is not the boundary.
  await requireUser();

  return (
    <main className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col justify-center px-4 py-16 sm:px-6 lg:px-8">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Deepam by Ananta</h1>
        <p className="mt-2 text-sm text-ink-2">Pick a module to open.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/flow"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Overview</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            How the modules connect — one customer journey from walk-in to delivery.
          </p>
        </Link>

        <Link
          href="/daily"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <rect x="3" y="4" width="18" height="17" rx="2" />
              <path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Daily dashboard</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            One day, every store: walk-ins, sales, driver visits, commission owed, calls and stock alerts.
          </p>
        </Link>

        <Link
          href="/reports"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Reports</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Funnel, salespeople, payback, cohorts and stock, across every app.
          </p>
        </Link>

        <Link
          href="/crm"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <path d="M3 12a9 9 0 1 0 9-9" strokeLinecap="round" />
              <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Customer Intelligence</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Lead attribution, the sales dashboard, insights and analysis — the customer-facing
            side of the business.
          </p>
        </Link>

        <a
          href="/__gate/go?to=https%3A%2F%2Fn7v6pm6bm2.ap-south-1.awsapprunner.com%2F"
          rel="noreferrer"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <path d="M3 7l9-4 9 4-9 4-9-4Z" strokeLinejoin="round" />
              <path d="M3 7v10l9 4 9-4V7" strokeLinejoin="round" />
              <path d="M12 11v10" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Vendor Intelligence</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Stock ledger, sell-through and margin by vendor and item — inventory, not people.
          </p>
        </a>

        <a
          href="/__gate/go?to=https%3A%2F%2F2q9cmkmxnu.ap-south-1.awsapprunner.com%2F"
          rel="noreferrer"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <path d="M5 20V10l7-6 7 6v10" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 20v-5h6v5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Driver Network Management</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Open the Driver Network Management workspace in its dedicated application.
          </p>
        </a>

        <a
          href="/__gate/go?to=https%3A%2F%2Fna8yspyqqp.ap-south-1.awsapprunner.com%2F"
          rel="noreferrer"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Store Performance Tracker</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Open the Store Performance Tracker workspace in its dedicated application.
          </p>
        </a>

        <Link
          href="/marketing"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <path d="M3 10v4h4l6 4V6L7 10H3Z" strokeLinejoin="round" />
              <path d="M17 9a4 4 0 0 1 0 6" strokeLinecap="round" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Marketing Intelligence</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Campaign leads, the calling queue and salesperson follow-up.
          </p>
        </Link>
      </div>
    </main>
  );
}
