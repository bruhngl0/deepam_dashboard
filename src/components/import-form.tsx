/**
 * Master-sheet import form.
 *
 * Preview, then commit — the same two-step shape as the CLI script
 * (`file.xlsx` then `file.xlsx --commit`), because that shape is the whole
 * safety model: nobody should be able to replace the lead layer without
 * first seeing the counts that replacement will produce.
 *
 * The file is kept in a ref between the two calls rather than uploaded once
 * and cached server-side (see the note on `preview/route.ts`) — the trade is
 * a second upload of a small workbook for not needing any session state.
 */

'use client';

import { useRef, useState } from 'react';
import { formatNumber } from '@/lib/format';
import type { MasterSheetPreviewResponse } from '@/app/api/import/master-sheet/preview/route';
import type { MasterSheetCommitSummary } from '@/lib/import/master-sheet';

type Status = 'idle' | 'previewing' | 'previewed' | 'committing' | 'committed' | 'error';

const SHEET_LABEL: Record<string, string> = {
  meta: 'Instagram',
  whatsapp: 'WhatsApp',
  google: 'Google Ads',
  other: 'Others',
};

export function ImportForm({ commitEnabled }: { commitEnabled: boolean }) {
  const [status, setStatus] = useState<Status>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<MasterSheetPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<MasterSheetCommitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  // Holds the actual File for the commit fetch — read only from event
  // handlers, never from render (a ref's `.current` is not safe to read
  // there); `fileName` above is the render-safe copy of the one field the UI
  // displays.
  const fileRef = useRef<File | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    fileRef.current = file;
    setFileName(file?.name ?? null);
    setPreview(null);
    setCommitResult(null);
    setError(null);
    setConfirmText('');
    if (!file) {
      setStatus('idle');
      return;
    }

    setStatus('previewing');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/import/master-sheet/preview', { method: 'POST', body });
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
      const res = await fetch('/api/import/master-sheet/commit', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Import failed.');
      setCommitResult(json);
      setStatus('committed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
      setStatus('error');
    }
  }

  const confirmed = confirmText.trim().toUpperCase() === 'REPLACE';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label
          htmlFor="workbook"
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink shadow-sm hover:bg-inset"
        >
          Choose workbook (.xlsx)
        </label>
        <input
          id="workbook"
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          className="sr-only"
        />
        {fileName && <span className="ml-3 text-sm text-ink-2">{fileName}</span>}
      </div>

      {status === 'previewing' && <p className="text-sm text-ink-muted">Reading workbook…</p>}

      {error && (
        <div className="rounded-xl border border-status-critical/30 bg-status-critical/10 px-4 py-3 text-sm text-status-critical">
          {error}
        </div>
      )}

      {preview && (status === 'previewed' || status === 'committing') && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-grid bg-inset/60 text-[11px] uppercase tracking-[0.09em] text-ink-muted">
                <th className="px-3 py-2 text-left font-medium">Sheet</th>
                <th className="px-3 py-2 text-right font-medium">Rows</th>
                <th className="px-3 py-2 text-right font-medium">Valid</th>
                <th className="px-3 py-2 text-right font-medium">Distinct</th>
                <th className="px-3 py-2 text-right font-medium">Dupes</th>
                <th className="px-3 py-2 text-right font-medium">Rejected</th>
                <th className="px-3 py-2 text-right font-medium">Flagged</th>
              </tr>
            </thead>
            <tbody>
              {preview.sheets.map((s) => (
                <tr key={s.sheet} className="border-t border-grid">
                  <td className="px-3 py-2 text-ink">
                    {s.sheet}
                    <span className="ml-2 text-xs text-ink-muted">
                      {SHEET_LABEL[s.channel] ?? s.channel}
                    </span>
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {formatNumber(s.rawRows)}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {formatNumber(s.validRows)}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {formatNumber(s.distinctRows)}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {formatNumber(s.duplicates)}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {formatNumber(s.rejected)}
                    {s.rejectedByCode.length > 0 && (
                      <span className="ml-1.5 text-xs text-ink-muted">
                        ({s.rejectedByCode.map((r) => `${r.code} ${r.n}`).join(', ')})
                      </span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {formatNumber(s.flagged)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line font-medium">
                <td className="px-3 py-2 text-ink">Distinct people across all sheets</td>
                <td colSpan={6} className="tnum px-3 py-2 text-right text-ink">
                  {formatNumber(preview.distinctPeople)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {preview && status !== 'committed' && (
        <div className="rounded-xl border border-status-critical/30 bg-status-critical/5 p-4">
          <p className="text-sm font-medium text-ink">
            Committing replaces the entire lead layer.
          </p>
          <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-ink-2">
            Every lead touch, follow-up, walk-in submission and lead campaign is deleted and
            reloaded from this file. Customers and sales are never touched, but 143 customers
            currently classified existing by the (now-gone) walk-in form would fall back to
            new — see the CLI script&rsquo;s header for the full cost. This cannot be undone from
            here.
          </p>

          {commitEnabled ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="confirm" className="text-sm text-ink-2">
                Type <span className="font-mono font-semibold text-ink">REPLACE</span> to enable
                the button:
              </label>
              <input
                id="confirm"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-32 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              {/* A fixed color, not the theme-reactive status token: the one truly
                  destructive control in the app should read the same in both
                  themes rather than shift with dark mode's lighter status ramp,
                  which would drop white-text contrast below a readable level. */}
              <button
                type="button"
                disabled={!confirmed || status === 'committing'}
                onClick={handleCommit}
                className="rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === 'committing' ? 'Committing…' : 'Replace lead data'}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              Committing is disabled on this deployment. The dashboard has no authentication yet
              (D-89), so the server refuses this even if you click through — see{' '}
              <code className="text-xs">ALLOW_MASTER_SHEET_IMPORT</code> in{' '}
              <code className="text-xs">.env.example</code>.
            </p>
          )}
        </div>
      )}

      {commitResult && (
        <div className="rounded-xl border border-status-good/30 bg-status-good/10 p-4">
          <p className="text-sm font-medium text-ink">Committed.</p>
          <p className="tnum mt-1 text-sm text-ink-2">
            {formatNumber(commitResult.customersUpserted)} customers upserted ·{' '}
            {formatNumber(commitResult.touchesInserted)} touches inserted ·{' '}
            {formatNumber(commitResult.rejectsStored)} rows rejected
          </p>
          <p className="mt-2 text-sm text-ink-2">
            Refresh the dashboard to see the new numbers.
          </p>
        </div>
      )}
    </div>
  );
}
