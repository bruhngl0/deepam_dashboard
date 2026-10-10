'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format';
import type { HemparshwaCopy } from '@/lib/integration/hemparshwa-status';
import type { HemparshwaRun } from '@/lib/integration/hemparshwa-schedule';

type Outcome = { ok: true; run: HemparshwaRun } | { ok: false; error: string };

function describe(run: HemparshwaRun): string {
  if (run.synced.length === 0 && run.removed.length === 0) return 'Already up to date — nothing new in Hemparshwa OS.';
  const parts: string[] = [];
  const rows = run.synced.reduce((n, s) => n + s.rows, 0);
  if (run.synced.length > 0) parts.push(`${formatNumber(run.synced.length)} import${run.synced.length === 1 ? '' : 's'} pulled (${formatNumber(rows)} rows)`);
  if (run.removed.length > 0) parts.push(`${formatNumber(run.removed.length)} removed`);
  if (run.customers && run.customers.added + run.customers.updated > 0) {
    parts.push(`${formatNumber(run.customers.added)} customers added and ${formatNumber(run.customers.updated)} updated from the Customer Master`);
  }
  if (run.projection) parts.push(`${formatNumber(run.projection.bills)} bills now in CRM`);
  return `${parts.join(', ')}.`;
}

const TYPE_LABEL: Record<string, string> = { sales: 'Sales', customers: 'Customer Master' };

export function HemparshwaSyncPanel({ copy, everyHours }: { copy: HemparshwaCopy; everyHours: number }) {
  const router = useRouter();
  const salesImports = copy.imports.filter((i) => i.dataType === 'sales').length;
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function syncNow() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch('/api/import/hemparshwa-sync', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Sync failed.');
      setOutcome({ ok: true, run: json });
      router.refresh();
    } catch (err) {
      setOutcome({ ok: false, error: err instanceof Error ? err.message : 'Sync failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-inset/40 p-4">
        <p className="tnum max-w-[60ch] text-sm text-ink-2">
          {salesImports === 0
            ? 'No sales have been pulled from Hemparshwa OS yet.'
            : `${formatNumber(copy.bills)} bills worth ${formatCurrency(copy.netSales)} from ${formatNumber(salesImports)} import${salesImports === 1 ? '' : 's'}.`}{' '}
          {copy.masterCustomers > 0 && `${formatNumber(copy.masterCustomers)} customers from the Customer Master. `}
          {copy.configured
            ? everyHours > 0
              ? `Checked every ${formatNumber(everyHours)} hours.`
              : 'The automatic check is off.'
            : 'Hemparshwa OS is not connected on this server.'}
        </p>
        <button
          type="button"
          disabled={busy || !copy.configured}
          onClick={syncNow}
          className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 enabled:active:scale-95"
        >
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {outcome && (
        <p role="status" className={`text-sm font-medium ${outcome.ok ? 'text-status-good' : 'text-status-critical'}`}>
          {outcome.ok ? describe(outcome.run) : outcome.error}
        </p>
      )}

      {copy.imports.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                <th className="py-2 pr-4 font-bold">File</th>
                <th className="py-2 pr-4 font-bold">Data</th>
                <th className="py-2 pr-4 text-right font-bold">Rows</th>
                <th className="py-2 pr-4 font-bold">Imported in Hemparshwa</th>
                <th className="py-2 font-bold">Pulled into CRM</th>
              </tr>
            </thead>
            <tbody>
              {copy.imports.map((i) => (
                <tr key={i.importId} className="border-t border-grid">
                  <td className="py-2 pr-4 text-ink">{i.fileName}</td>
                  <td className="py-2 pr-4 text-ink-2">{TYPE_LABEL[i.dataType] ?? i.dataType}</td>
                  <td className="tnum py-2 pr-4 text-right text-ink-2">{formatNumber(i.rows)}</td>
                  <td className="tnum py-2 pr-4 text-ink-2">{formatDateTime(i.importedAt)}</td>
                  <td className="tnum py-2 text-ink-2">{formatDateTime(i.syncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
