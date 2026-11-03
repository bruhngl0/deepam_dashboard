/**
 * Every bill in the period, split by who the customer is. The groups never
 * overlap, so they add up to the Total row, which equals the Total sales tile.
 */

import Link from 'next/link';
import { formatCurrency, formatCurrencyCompact, formatNumber } from '@/lib/format';
import { SALES_SOURCE_INFO, type NewCustomerSegment, type SalesBySource } from '@/lib/queries/new-customers';

export function SalesBySourcePanel({ data, newCustomersHref }: { data: SalesBySource; newCustomersHref: (segment: NewCustomerSegment) => string }) {
  const share = (value: number) => (data.total.sales ? (100 * value) / data.total.sales : 0);
  return (
    <section className="card rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold tracking-tight text-ink">Sales by customer source</h2>
      <p className="mt-1 text-sm text-ink-2">
        Every bill in the period in exactly one group, so the rows add up to Total sales. A bill goes to the loyalty list
        first, then foreign numbers, then the new-customer groups; bills with no phone number have no customer.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
              <th className="pb-2 text-left font-bold">Customer source</th>
              <th className="pb-2 text-right font-bold">Customers</th>
              <th className="pb-2 text-right font-bold">Bills</th>
              <th className="pb-2 text-right font-bold">Sales</th>
              <th className="w-48 pb-2 pl-4 text-left font-bold">Share of sales</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const info = SALES_SOURCE_INFO[row.source];
              const pct = share(row.sales);
              return (
                <tr key={row.source} className="border-t border-grid align-top">
                  <td className="py-2.5 pr-4">
                    {info.segment ? (
                      <Link href={newCustomersHref(info.segment)} className="font-medium text-accent hover:underline">{info.label}</Link>
                    ) : (
                      <span className="font-medium text-ink">{info.label}</span>
                    )}
                    <p className="text-xs text-ink-muted">{info.definition}</p>
                  </td>
                  <td className="tnum py-2.5 text-right text-ink-2">{row.source === 'no_phone' ? '—' : formatNumber(row.customers)}</td>
                  <td className="tnum py-2.5 text-right text-ink-2">{formatNumber(row.bills)}</td>
                  <td className="tnum py-2.5 text-right text-ink" title={formatCurrency(row.sales)}>{formatCurrencyCompact(row.sales)}</td>
                  <td className="py-2.5 pl-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-inset">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="tnum w-12 text-right text-xs text-ink-2">{pct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-line font-semibold">
              <td className="py-2.5 text-ink">Total</td>
              <td className="tnum py-2.5 text-right text-ink">{formatNumber(data.total.customers)}</td>
              <td className="tnum py-2.5 text-right text-ink">{formatNumber(data.total.bills)}</td>
              <td className="tnum py-2.5 text-right text-ink" title={formatCurrency(data.total.sales)}>{formatCurrencyCompact(data.total.sales)}</td>
              <td className="tnum py-2.5 pl-4 text-xs text-ink-2">{formatCurrency(data.total.sales)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
