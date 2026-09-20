/**
 * Hero — module picker.
 *
 * Four independent modules live behind this app: the in-app phone-attributed
 * CRM (`/crm`) and vendor stock/margin module (`/vendor`), plus the Driver RC
 * and Walkin Track services. This page is just the door between them, not a
 * dashboard of its own, so `NavTabs` shows nothing here (see
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
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Ananta OS</h1>
        <p className="mt-2 text-sm text-ink-2">Pick a module to open.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
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
          <h2 className="text-lg font-semibold tracking-tight text-ink">CRM</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Lead attribution, the sales dashboard, insights and analysis — the customer-facing
            side of the business.
          </p>
        </Link>

        <Link
          href="/vendor"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <path d="M3 7l9-4 9 4-9 4-9-4Z" strokeLinejoin="round" />
              <path d="M3 7v10l9 4 9-4V7" strokeLinejoin="round" />
              <path d="M12 11v10" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Vendor</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Stock ledger, sell-through and margin by vendor and item — inventory, not people.
          </p>
        </Link>

        <Link
          href="https://2q9cmkmxnu.ap-south-1.awsapprunner.com/"
          target="_blank"
          rel="noreferrer"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <path d="M5 20V10l7-6 7 6v10" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 20v-5h6v5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Driver RC</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Open the Driver RC workspace in its dedicated application.
          </p>
          <span className="mt-auto text-sm font-medium text-accent">Open module ↗</span>
        </Link>

        <Link
          href="https://na8yspyqqp.ap-south-1.awsapprunner.com"
          target="_blank"
          rel="noreferrer"
          className="card card-interactive group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]">
              <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Walkin Track</h2>
          <p className="max-w-[36ch] text-sm text-ink-2">
            Open the Walkin Track workspace in its dedicated application.
          </p>
          <span className="mt-auto text-sm font-medium text-accent">Open module ↗</span>
        </Link>
      </div>
    </main>
  );
}
