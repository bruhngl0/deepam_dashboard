/**
 * Online customers card: people added from the Shopify customer export.
 *
 * They have no lead touch, so the channel figures elsewhere on the dashboard
 * leave them out; this card counts them, and its link narrows the customer
 * table below to them (`source=shopify`).
 */

import Link from 'next/link';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { OnlineCustomers } from '@/lib/queries/dashboard';

function Item({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="tnum text-xl font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-sm text-ink-2">{label}</p>
    </div>
  );
}

export function OnlineCustomersCard({ data, href, active }: { data: OnlineCustomers; href: string; active: boolean }) {
  return (
    <section aria-label="Online customers" className="card mt-3 rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Online customers</h2>
          <p className="mt-1 text-sm text-ink-2">
            Customers added from Shopify. They have no lead record, so the channel figures above do not include them. All time.
          </p>
        </div>
        <Link
          href={href}
          aria-current={active ? 'true' : undefined}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-2 shadow-sm transition-colors hover:bg-inset hover:text-ink active:scale-95"
        >
          {active ? 'Showing them below' : 'Show them in the table'}
        </Link>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Item value={formatNumber(data.customers)} label="online customers" />
        <Item value={formatNumber(data.paid)} label="have paid online orders" />
        <Item value={formatCurrency(data.shopifySales)} label="paid online sales (Shopify)" />
        <Item value={formatNumber(data.storeBuyers)} label={`have also bought in store · ${formatCurrency(data.storeSales)}`} />
      </div>
    </section>
  );
}
