/**
 * Barcode-wise sales import form — preview-then-commit, upserting on
 * `(voucher_date_raw, voucher_no_raw, barcode)`. No confirm-text gate, same
 * reasoning as the sales report form.
 */

'use client';

import { useRef, useState } from 'react';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { SaleLineItemsPreviewResponse } from '@/app/api/import/sale-line-items/preview/route';
import type { SaleLineItemsCommitResult } from '@/lib/import/sale-line-items';

type Status = 'idle' | 'previewing' | 'previewed' | 'committing' | 'committed' | 'error';

export function SaleLineItemsImportForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<SaleLineItemsPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<SaleLineItemsCommitResult | null>(null);
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
      const res = await fetch('/api/import/sale-line-items/preview', { method: 'POST', body });
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
      const res = await fetch('/api/import/sale-line-items/commit', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Import failed.');
      setCommitResult(json);
      setStatus('committed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
      setStatus('error');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label
          htmlFor="sale-line-items-workbook"
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
              {fileName ?? 'Choose barcode-wise sales register (.xlsx)'}
            </span>
            <span className="text-xs text-ink-muted">
              {fileName ? 'Click to choose a different file' : 'e.g. "Barcode Wise …xlsx" — item-level detail, enriches existing bills'}
            </span>
          </span>
        </label>
        <input
          id="sale-line-items-workbook"
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
              {preview.alreadyImported && (
                <span className="text-xs text-ink-muted">
                  ⚠ this exact file has been committed before — re-import is a no-op
                </span>
              )}
            </p>
            <p className="tnum text-sm font-medium text-ink">
              {formatNumber(preview.linesTotal)} lines · {formatCurrency(preview.grossSalesAmt)}
            </p>
          </div>

          <p className="tnum mt-3 text-xs text-ink-muted">
            {formatNumber(preview.uniqueVouchers)} vouchers · {formatNumber(preview.uniqueBarcodes)}{' '}
            unique barcodes · net qty {formatNumber(preview.netQty)}
            {preview.negativeQtyLines > 0 && ` · ${formatNumber(preview.negativeQtyLines)} return lines`}
            {preview.duplicateRowsInFile > 0 &&
              ` · ${formatNumber(preview.duplicateRowsInFile)} duplicate rows in file`}
            {preview.rejectedByCode.length > 0 && (
              <>
                {' '}
                · rejected: {preview.rejectedByCode.map((r) => `${r.code} ${r.n}`).join(', ')}
              </>
            )}
          </p>
        </div>
      )}

      {preview && status !== 'committed' && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-inset/40 p-4">
          <p className="max-w-[52ch] text-sm text-ink-2">
            Adds item-level detail and links it to existing bills where a match is found — bills
            themselves are never replaced.
          </p>
          <button
            type="button"
            disabled={status === 'committing'}
            onClick={handleCommit}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 enabled:active:scale-95"
          >
            {status === 'committing' ? 'Committing…' : 'Add sale line items'}
          </button>
        </div>
      )}

      {commitResult && (
        <div className="rounded-xl border border-status-good/30 bg-status-good/10 p-4">
          <p className="text-sm font-medium text-ink">Committed.</p>
          <p className="tnum mt-1 text-sm text-ink-2">
            {formatNumber(commitResult.rowsInserted)} rows inserted ·{' '}
            {formatNumber(commitResult.rowsUpdated)} updated ·{' '}
            {formatNumber(commitResult.matchedToSale)} matched to a bill ·{' '}
            {formatNumber(commitResult.unmatched)} unmatched ·{' '}
            {formatNumber(commitResult.rejectedStored)} rows rejected
          </p>
        </div>
      )}
    </div>
  );
}
