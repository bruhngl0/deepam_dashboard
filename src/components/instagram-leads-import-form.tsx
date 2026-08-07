/**
 * Instagram/Meta leads import form — additive, unlike the master-workbook
 * form above it. Same preview-then-commit shape (nothing writes to the
 * database until the file has been seen once), but no confirm-text gate:
 * the worst outcome here is adding people who are genuinely in the file, not
 * losing data. See `lib/import/instagram-leads.ts` for what this does.
 */

'use client';

import { useRef, useState } from 'react';
import { formatNumber } from '@/lib/format';
import type { InstagramLeadsPreviewResponse } from '@/app/api/import/instagram-leads/preview/route';
import type { InstagramLeadsCommitResult } from '@/lib/import/instagram-leads';

type Status = 'idle' | 'previewing' | 'previewed' | 'committing' | 'committed' | 'error';

export function InstagramLeadsImportForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<InstagramLeadsPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<InstagramLeadsCommitResult | null>(null);
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
      const res = await fetch('/api/import/instagram-leads/preview', { method: 'POST', body });
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
      const res = await fetch('/api/import/instagram-leads/commit', { method: 'POST', body });
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
          htmlFor="instagram-workbook"
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
              {fileName ?? 'Choose Instagram/Meta export (.xlsx)'}
            </span>
            <span className="text-xs text-ink-muted">
              {fileName ? 'Click to choose a different file' : 'Per-campaign export — one sheet per campaign'}
            </span>
          </span>
        </label>
        <input
          id="instagram-workbook"
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
        <div className="card overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-grid bg-inset/60 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                <th className="px-3 py-2 text-left font-bold">Sheet</th>
                <th className="px-3 py-2 text-right font-bold">Rows</th>
                <th className="px-3 py-2 text-right font-bold">New</th>
                <th className="px-3 py-2 text-right font-bold">Already known</th>
                <th className="px-3 py-2 text-right font-bold">Dupes</th>
                <th className="px-3 py-2 text-right font-bold">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {preview.sheets.map((s) => (
                <tr key={s.sheet} className="border-t border-grid transition-colors hover:bg-inset/50">
                  <td className="px-3 py-2 text-ink">
                    {s.sheet}
                    {s.alreadyImported && (
                      <span className="ml-2 text-xs text-ink-muted">already committed once</span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">{formatNumber(s.dataRows)}</td>
                  <td className="tnum px-3 py-2 text-right font-medium text-ink">
                    {formatNumber(s.newCustomers)}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {formatNumber(s.existingCustomers)}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {formatNumber(s.duplicatesInFile)}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {formatNumber(s.rejected)}
                    {s.rejectedByCode.length > 0 && (
                      <span className="ml-1.5 text-xs text-ink-muted">
                        ({s.rejectedByCode.map((r) => `${r.code} ${r.n}`).join(', ')})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line font-medium">
                <td className="px-3 py-2 text-ink">Distinct people across all sheets</td>
                <td colSpan={5} className="tnum px-3 py-2 text-right text-ink">
                  {formatNumber(preview.distinctPeople)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {preview && status !== 'committed' && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-inset/40 p-4">
          <p className="max-w-[52ch] text-sm text-ink-2">
            Adds new phone numbers under the existing <strong>Master Sheet — Meta</strong>{' '}
            campaign. WhatsApp, Google Ads and Others are untouched, and nothing is deleted.
          </p>
          <button
            type="button"
            disabled={status === 'committing'}
            onClick={handleCommit}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 enabled:active:scale-95"
          >
            {status === 'committing' ? 'Committing…' : 'Add new leads'}
          </button>
        </div>
      )}

      {commitResult && (
        <div className="rounded-xl border border-status-good/30 bg-status-good/10 p-4">
          <p className="text-sm font-medium text-ink">Committed.</p>
          <p className="tnum mt-1 text-sm text-ink-2">
            {formatNumber(commitResult.touchesInserted)} new lead touches ·{' '}
            {formatNumber(commitResult.customersUpserted)} customers upserted ·{' '}
            {formatNumber(commitResult.rejectedStored)} rows rejected
          </p>
          <p className="mt-2 text-sm text-ink-2">Refresh the dashboard to see the new numbers.</p>
        </div>
      )}
    </div>
  );
}
