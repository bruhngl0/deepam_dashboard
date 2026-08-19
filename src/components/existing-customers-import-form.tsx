/**
 * Existing-customer seed import form — preview-then-commit, upserting on
 * phone. Meant to run once, before any lead or sales import, so those later
 * imports' lifecycle recompute already has this evidence to weigh.
 */

'use client';

import { useRef, useState } from 'react';
import { formatNumber } from '@/lib/format';
import type { ExistingCustomersPreviewResponse } from '@/app/api/import/existing-customers/preview/route';
import type { ExistingCustomersCommitResult } from '@/lib/import/existing-customers';

type Status = 'idle' | 'previewing' | 'previewed' | 'committing' | 'committed' | 'error';

export function ExistingCustomersImportForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExistingCustomersPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<ExistingCustomersCommitResult | null>(null);
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
      const res = await fetch('/api/import/existing-customers/preview', { method: 'POST', body });
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
      const res = await fetch('/api/import/existing-customers/commit', { method: 'POST', body });
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
          htmlFor="existing-customers-file"
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
              {fileName ?? 'Choose loyalty/CRM export (.csv or .xlsx)'}
            </span>
            <span className="text-xs text-ink-muted">
              {fileName ? 'Click to choose a different file' : 'A full customer master export — can run to six figures of rows'}
            </span>
          </span>
        </label>
        <input
          id="existing-customers-file"
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileChange}
          className="sr-only"
        />
      </div>

      {status === 'previewing' && (
        <p className="text-sm text-ink-muted">Reading file… this can take a while for a large export.</p>
      )}

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
              {formatNumber(preview.rowsTotal)} customers · {formatNumber(preview.uniquePhones)} unique phones
            </p>
          </div>

          <p className="tnum mt-3 text-xs text-ink-muted">
            {formatNumber(preview.withBillHistory)} with bill history (provable) ·{' '}
            {formatNumber(preview.withoutBillHistory)} loyalty-registered only
            {preview.duplicatePhonesInFile > 0 &&
              ` · ${formatNumber(preview.duplicatePhonesInFile)} duplicate phones in file`}
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
            Marks everyone in this file lifecycle = existing, upserting on phone. Run this before any
            lead or sales import so those later imports see this evidence.
          </p>
          <button
            type="button"
            disabled={status === 'committing'}
            onClick={handleCommit}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 enabled:active:scale-95"
          >
            {status === 'committing' ? 'Committing… this can take a few minutes' : 'Seed existing customers'}
          </button>
        </div>
      )}

      {commitResult && (
        <div className="rounded-xl border border-status-good/30 bg-status-good/10 p-4">
          <p className="text-sm font-medium text-ink">Committed.</p>
          <p className="tnum mt-1 text-sm text-ink-2">
            {formatNumber(commitResult.customersInserted)} customers inserted ·{' '}
            {formatNumber(commitResult.customersUpdated)} updated ·{' '}
            {formatNumber(commitResult.loyaltyRowsWritten)} loyalty rows written ·{' '}
            {formatNumber(commitResult.rejectedStored)} rows rejected
          </p>
        </div>
      )}
    </div>
  );
}
