/**
 * Sales report import form — additive, idempotent (D-04, D-59). Same
 * preview-then-commit shape as the other two forms; no confirm-text gate,
 * since a duplicate upload is a harmless no-op rather than data loss.
 */

'use client';

import { useRef, useState } from 'react';
import { formatCurrency, formatNumber, formatDate } from '@/lib/format';
import type { SalesPreviewResponse } from '@/app/api/import/sales/preview/route';
import type { SalesCommitResult } from '@/lib/import/sales';

type Status = 'idle' | 'previewing' | 'previewed' | 'committing' | 'committed' | 'error';

export function SalesImportForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<SalesPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<SalesCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    fileRef.current = file;
    setFileName(file?.name ?? null);
    setPreview(null);
    setCommitResult(null);
    setError(null);
    if (!file) {
      setStatus('idle');
      return;
    }

    setStatus('previewing');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/import/sales/preview', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Preview failed.');
      setPreview(json);
      setStatus('previewed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed.');
      setStatus('error');
    }
  }

  async function handleCommit() {
    const file = fileRef.current;
    if (!file) return;

    setStatus('committing');
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/import/sales/commit', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Import failed.');
      setCommitResult(json);
      setStatus('committed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
      setStatus('error');
    }
  }

  const blockedByUnknownPrefix = (preview?.unknownPrefixes.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label
          htmlFor="sales-workbook"
          className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line bg-inset/40 px-5 py-4 text-sm text-ink transition-colors hover:border-accent/50 hover:bg-accent-soft/20"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft/50 text-accent transition-colors group-hover:bg-accent-soft">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-[1.8]">
              <path d="M12 16V4M12 4l-4 4M12 4l4 4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="flex flex-col">
            <span className="font-medium text-ink">
              {fileName ?? 'Choose POS sales report (.xlsx)'}
            </span>
            <span className="text-xs text-ink-muted">
              {fileName ? 'Click to choose a different file' : 'One period per file — becomes its own report in Analysis'}
            </span>
          </span>
        </label>
        <input
          id="sales-workbook"
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          className="sr-only"
        />
      </div>

      {status === 'previewing' && <p className="text-sm text-ink-muted">Reading workbook…</p>}

      {error && (
        <div className="rounded-xl border border-status-critical/30 bg-status-critical/10 px-4 py-3 text-sm text-status-critical">
          {error}
        </div>
      )}

      {preview && (status === 'previewed' || status === 'committing') && (
        <div className="card rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-sm text-ink">
              {preview.dateRange
                ? `${formatDate(preview.dateRange.from)} – ${formatDate(preview.dateRange.to)}`
                : 'Date range unknown'}
              {preview.alreadyImported && (
                <span className="ml-2 text-xs text-ink-muted">
                  ⚠ this exact file has been committed before — re-import is a no-op
                </span>
              )}
            </p>
            <p className="tnum text-sm font-medium text-ink">
              {formatNumber(preview.billsTotal)} bills · {formatCurrency(preview.grossRevenue)}
            </p>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-grid text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                  <th className="px-3 py-2 text-left font-bold">Prefix</th>
                  <th className="px-3 py-2 text-left font-bold">Store</th>
                  <th className="px-3 py-2 text-right font-bold">Bills</th>
                  <th className="px-3 py-2 text-right font-bold">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {preview.storeBreakdown.map((s) => (
                  <tr key={s.prefix} className="border-t border-grid">
                    <td className="px-3 py-2 text-ink-2">{s.prefix}</td>
                    <td className="px-3 py-2 text-ink">{s.store}</td>
                    <td className="tnum px-3 py-2 text-right text-ink-2">{formatNumber(s.bills)}</td>
                    <td className="tnum px-3 py-2 text-right font-medium text-ink">
                      {formatCurrency(s.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="tnum mt-3 text-xs text-ink-muted">
            {formatNumber(preview.withPhone)} bills with phone · {formatNumber(preview.withoutPhone)}{' '}
            without ({formatCurrency(preview.revenueWithoutPhone)}) · {formatNumber(preview.uniquePhones)}{' '}
            unique phones
            {preview.rejectedByCode.length > 0 && (
              <>
                {' '}
                · rejected: {preview.rejectedByCode.map((r) => `${r.code} ${r.n}`).join(', ')}
              </>
            )}
          </p>

          {blockedByUnknownPrefix && (
            <p className="mt-2 text-sm text-status-critical">
              Unmapped voucher prefixes: {preview.unknownPrefixes.join(', ')}. Add them to{' '}
              <code className="text-xs">stores.voucher_prefix</code> before committing.
            </p>
          )}
        </div>
      )}

      {preview && status !== 'committed' && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-inset/40 p-4">
          <p className="max-w-[52ch] text-sm text-ink-2">
            Adds these bills as a new, independent report — existing sales are never replaced.
            It becomes selectable in the Analysis page&rsquo;s report dropdown right after.
          </p>
          <button
            type="button"
            disabled={status === 'committing' || blockedByUnknownPrefix}
            onClick={handleCommit}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 enabled:active:scale-95"
          >
            {status === 'committing' ? 'Committing…' : 'Add sales report'}
          </button>
        </div>
      )}

      {commitResult && (
        <div className="rounded-xl border border-status-good/30 bg-status-good/10 p-4">
          <p className="text-sm font-medium text-ink">Committed.</p>
          <p className="tnum mt-1 text-sm text-ink-2">
            {formatNumber(commitResult.salesInserted)} bills inserted ·{' '}
            {formatNumber(commitResult.salesSkipped)} skipped (dupes) ·{' '}
            {formatNumber(commitResult.customersInserted)} customers touched ·{' '}
            {formatNumber(commitResult.rejectedStored)} rows rejected
          </p>
          <p className="mt-2 text-sm text-ink-2">
            Refresh the <a href="/analysis" className="text-accent hover:underline">Analysis page</a>{' '}
            to see it in the report dropdown.
          </p>
        </div>
      )}
    </div>
  );
}
