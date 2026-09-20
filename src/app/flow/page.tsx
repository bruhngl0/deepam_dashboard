/**
 * Cross-module operating flow.
 *
 * This is deliberately a static architecture view rather than a dashboard:
 * until the external applications expose APIs/webhooks, it describes the
 * contract needed to safely connect them without coupling their databases.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';

type ModuleCardProps = {
  name: string;
  description: string;
  produces: string;
  href: string;
  external?: boolean;
  icon: React.ReactNode;
};

function ModuleCard({ name, description, produces, href, external, icon }: ModuleCardProps) {
  return (
    <Link
      href={href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="card group flex min-h-44 flex-col rounded-2xl border border-line bg-surface p-5 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">{icon}</span>
      <h2 className="mt-4 text-base font-semibold tracking-tight text-ink">{name}</h2>
      <p className="mt-1 text-sm text-ink-2">{description}</p>
      <p className="mt-auto pt-4 text-xs font-medium text-accent">{produces} <span aria-hidden="true">{external ? '↗' : '→'}</span></p>
    </Link>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-3 text-center" aria-hidden="true">
      <span className="rounded-full border border-line bg-page px-2.5 py-1 text-[11px] font-medium text-ink-muted">{label}</span>
      <svg viewBox="0 0 20 24" className="h-6 w-5 text-accent fill-none stroke-current stroke-[1.75]">
        <path d="M10 1v18M4 14l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default async function FlowPage() {
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Operating model</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">One customer journey, four specialist modules.</h1>
        <p className="mt-3 text-sm leading-6 text-ink-2">
          Each product remains the source of truth for its own work. Events move through one integration layer,
          producing a dependable shared view without joining application databases directly.
        </p>
      </header>

      <section aria-labelledby="flow-title" className="card overflow-hidden rounded-3xl border border-line bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-grid pb-4">
          <div>
            <h2 id="flow-title" className="text-lg font-semibold tracking-tight text-ink">Module connection flow</h2>
            <p className="mt-1 text-sm text-ink-2">From operational activity to a shared decision layer.</p>
          </div>
          <span className="rounded-full bg-accent-soft/50 px-3 py-1 text-xs font-medium text-accent">Recommended architecture</span>
        </div>

        <div className="mx-auto mt-6 max-w-5xl">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ModuleCard
              name="Walkin Track"
              description="Store arrivals, enquiries and product interest."
              produces="Visit · prospect · store event"
              href="https://na8yspyqqp.ap-south-1.awsapprunner.com"
              external
              icon={<svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]"><path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.5" /></svg>}
            />
            <ModuleCard
              name="CRM"
              description="Lead ownership, follow-up, sale and customer history."
              produces="Lead · customer · order event"
              href="/crm"
              icon={<svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]"><circle cx="12" cy="8" r="3.5" /><path d="M5 21a7 7 0 0 1 14 0" strokeLinecap="round" /></svg>}
            />
            <ModuleCard
              name="Vendor"
              description="SKU availability, purchase cost and stock movement."
              produces="SKU · stock · cost event"
              href="/vendor"
              icon={<svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]"><path d="m3 7 9-4 9 4-9 4-9-4ZM3 7v10l9 4 9-4V7M12 11v10" strokeLinejoin="round" /></svg>}
            />
            <ModuleCard
              name="Driver RC"
              description="Delivery assignments, status and proof of delivery."
              produces="Dispatch · delivery · cost event"
              href="https://2q9cmkmxnu.ap-south-1.awsapprunner.com/"
              external
              icon={<svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]"><path d="M3 6h11v11H3zM14 10h3l4 4v3h-7zM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            />
          </div>

          <Arrow label="Authenticated API calls & webhooks" />

          <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-2xl border border-accent/30 bg-accent-soft/25 p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-white">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.8]"><path d="M7 7h10M7 12h10M7 17h6" strokeLinecap="round" /><path d="M4 4h16v16H4z" strokeLinejoin="round" /></svg>
                </span>
                <div>
                  <h3 className="font-semibold tracking-tight text-ink">Integration layer</h3>
                  <p className="text-sm text-ink-2">Validates, deduplicates and routes versioned events.</p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <span className="rounded-lg bg-surface px-3 py-2 text-ink-2">Webhook receiver</span>
                <span className="rounded-lg bg-surface px-3 py-2 text-ink-2">Identity resolution</span>
                <span className="rounded-lg bg-surface px-3 py-2 text-ink-2">Retry & audit log</span>
              </div>
            </section>
            <section className="rounded-2xl border border-line bg-inset p-5">
              <h3 className="font-semibold tracking-tight text-ink">Shared identifiers</h3>
              <p className="mt-1 text-sm text-ink-2">The keys that make records joinable.</p>
              <p className="mt-4 font-mono text-xs leading-6 text-ink-2">customer_id · normalized_phone<br />order_id · SKU · store_id · driver_id</p>
            </section>
          </div>

          <Arrow label="Clean, linked event history" />

          <section className="rounded-2xl border border-line bg-inset p-5 sm:p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <h3 className="font-semibold tracking-tight text-ink">Unified decision layer</h3>
                <p className="mt-1 text-sm text-ink-2">A warehouse retains history; reporting reads it without slowing operational apps.</p>
              </div>
              <span className="mt-2 text-xs font-medium text-status-good sm:mt-0">Read-only analytics</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Conversion', 'Walk-in → lead → sale by store and product'],
                ['Availability', 'Missed demand where requested SKUs were unavailable'],
                ['Fulfilment', 'Order → delivery time and delivery success rate'],
                ['Profitability', 'Revenue − vendor cost − delivery cost'],
              ].map(([title, description]) => (
                <div key={title} className="rounded-xl border border-line bg-surface p-4">
                  <p className="font-medium text-ink">{title}</p>
                  <p className="mt-1 text-sm leading-5 text-ink-2">{description}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="mt-6 grid gap-3 lg:grid-cols-3">
        {[
          ['1. Establish IDs', 'Normalize phone numbers and agree ownership for customer, order, SKU, store and driver identifiers.'],
          ['2. Publish events', 'Start with visit-created, order-confirmed, stock-changed and delivery-completed webhooks.'],
          ['3. Build the view', 'Load immutable events into an analytics store and calculate conversion, fulfilment and margin there.'],
        ].map(([step, detail], index) => (
          <article key={step} className="card rounded-2xl border border-line bg-surface p-5">
            <span className="text-xs font-semibold text-accent">0{index + 1}</span>
            <h2 className="mt-2 font-semibold tracking-tight text-ink">{step}</h2>
            <p className="mt-1 text-sm leading-6 text-ink-2">{detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
