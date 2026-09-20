import Link from 'next/link';

const MODULES = [
  { href: '/vendor/vendors', step: '1', title: 'Vendor master', detail: 'Profiles, contacts, compliance and supplied categories.', action: 'Manage vendors' },
  { href: '/vendor/purchases', step: '2', title: 'Purchase operations', detail: 'POs, SKUs, receipts, QC, returns and store allocation.', action: 'Review purchases' },
  { href: '/vendor/performance', step: '3', title: 'Performance', detail: 'Stock health, margin, payments, due dates and vendor score.', action: 'Monitor performance' },
  { href: '/vendor/customer-insights', step: '4', title: 'Customer connection', detail: 'See demand records linked from customers to the supplying vendor.', action: 'Open customer hub' },
  { href: '/vendor/demand', step: '5', title: 'Demand planning', detail: 'Prioritise unmet demand and revenue opportunity by category.', action: 'Plan replenishment' },
  { href: '/vendor/import', step: 'Setup', title: 'Import centre', detail: 'Load stock ledgers and barcode-level sales with a safe preview.', action: 'Import data' },
] as const;

export function VendorAdminHub() {
  return (
    <section className="card mb-5 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.09em] text-ink-muted">Admin workspace</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">Run vendor operations in order</h2>
          <p className="mt-1 text-sm text-ink-2">Each module owns one decision, from supplier setup through demand fulfilment.</p>
        </div>
        <Link href="/vendor/import" className="text-sm font-medium text-accent hover:text-accent-strong">Need to load data? Start with import →</Link>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((module) => (
          <Link key={module.href} href={module.href} className="group rounded-xl border border-line bg-inset/35 p-4 transition hover:border-accent/40 hover:bg-accent-soft/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <div className="flex items-center justify-between gap-2"><span className="rounded-full bg-surface px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">{module.step}</span><span className="text-xs font-medium text-accent opacity-0 transition group-hover:opacity-100">{module.action} →</span></div>
            <h3 className="mt-3 font-semibold text-ink">{module.title}</h3>
            <p className="mt-1 text-xs leading-5 text-ink-2">{module.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
