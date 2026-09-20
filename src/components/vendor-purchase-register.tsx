import Link from 'next/link';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { PurchaseRegisterRow } from '@/lib/queries/vendor-workspace';

export function VendorPurchaseRegister({ rows }: { rows: PurchaseRegisterRow[] }) {
  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.09em] text-accent">Purchase operations</p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Purchase register</h1>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">PO, receipt, QC, returns and branch allocation at SKU level.</p>
        </div>
        <Link href="/vendor" className="text-sm font-medium text-accent">← Dashboard</Link>
      </header>
      <section className="card overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[98rem] text-sm">
          <thead className="bg-inset text-left text-[11px] font-bold uppercase tracking-[.08em] text-ink-muted">
            <tr>
              <th className="px-4 py-3">PO / vendor</th><th className="px-4 py-3">Purchase date</th><th className="px-4 py-3">Category / SKU</th>
              <th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">MRP</th>
              <th className="px-4 py-3">Received</th><th className="px-4 py-3">QC</th><th className="px-4 py-3 text-right">Return</th><th className="px-4 py-3">Store allocation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={`${row.poNumber}-${row.skuNo}`} className="border-t border-grid align-top">
              <td className="px-4 py-3"><p className="font-medium text-ink">{row.poNumber}</p><p className="text-xs text-ink-muted">{row.vendor}</p></td>
              <td className="px-4 py-3 text-ink-2">{new Date(row.purchaseDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              <td className="px-4 py-3"><p className="text-ink">{row.category}</p><p className="font-mono text-xs text-ink-muted">{row.skuNo}</p></td>
              <td className="tnum px-4 py-3 text-right text-ink">{formatNumber(row.qty)}</td><td className="tnum px-4 py-3 text-right text-ink">{formatCurrency(row.cost)}</td><td className="tnum px-4 py-3 text-right text-ink">{formatCurrency(row.mrp)}</td>
              <td className="px-4 py-3 text-ink-2">{row.receivedDate ? new Date(row.receivedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Awaiting'}</td>
              <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.qcStatus === 'passed' ? 'bg-status-good/10 text-status-good' : 'bg-accent-soft text-accent-strong'}`}>{row.qcStatus}</span></td>
              <td className="tnum px-4 py-3 text-right"><p className="text-ink">{formatNumber(row.returnQty)} units</p><p className="text-xs text-ink-muted">{formatCurrency(row.returnValue)}</p></td>
              <td className="px-4 py-3"><p className="text-ink">{row.store}</p><p className="tnum text-xs text-ink-muted">{formatNumber(row.allocatedQty)} units</p></td>
            </tr>)}
          </tbody>
        </table>
      </section>
    </main>
  );
}
