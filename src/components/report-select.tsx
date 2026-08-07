/**
 * Sales report picker for the Analysis page.
 *
 * Each option is one committed sales import batch (D-04: sales are appended,
 * never merged or replaced, so every upload stays its own selectable period).
 * Selection lives in the URL (`?batch=<id>`), same convention as every other
 * filter in the app (D-82) — shareable, and the back button works.
 */

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import type { SalesReport } from '@/lib/queries/analysis';

export function ReportSelect({ reports }: { reports: SalesReport[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = params.get('batch') ?? '';

  return (
    <div className={`flex items-center gap-2 ${pending ? 'opacity-70' : ''}`}>
      <label htmlFor="report-select" className="text-xs text-ink-muted">
        Sales report
      </label>
      <select
        id="report-select"
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set('batch', e.target.value);
          else next.delete('batch');
          startTransition(() => router.push(`${pathname}?${next.toString()}`));
        }}
        className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink transition-shadow focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        <option value="">All reports · every bill loaded</option>
        {reports.map((r) => (
          <option key={r.id} value={r.id}>
            {formatDate(r.from)} – {formatDate(r.to)} · {formatNumber(r.bills)} bills ·{' '}
            {formatCurrency(r.revenue)}
          </option>
        ))}
      </select>
    </div>
  );
}
