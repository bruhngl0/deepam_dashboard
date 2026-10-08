'use client';
import { useEffect, useState } from 'react';
import { SOURCES } from '@/lib/marketing/local';
import type { SheetSource, SyncStatus } from '@/lib/marketing/sheet-sync';
import { button, card, Field, input, primary } from './marketing-shared';

type Overview = { serviceEmail: string; keyError: string; sheets: SheetSource[]; status: SyncStatus | null; checkedAt: string | null; intervalMinutes: number };
const ist = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const API = '/api/marketing/sheet-sync';

/** Connects Google Sheets as live sources of leads. Every tab that is a lead list is imported. */
export function MarketingSheetSync({ onSynced }: { onSynced?: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [url, setUrl] = useState('');
  const [defaultSource, setDefaultSource] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(API, { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(setOverview).catch(() => setError('Could not load the Google Sheet connection.'));
  }, []);

  async function apply(label: string, body: object) {
    setBusy(label); setError('');
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await r.json().catch(() => null);
      if (!r.ok) { setError(json?.error ?? 'Something went wrong. Please retry.'); return; }
      setOverview(json as Overview); setUrl(''); setDefaultSource(''); onSynced?.();
    } catch { setError('Could not reach the server. Please retry.'); }
    finally { setBusy(''); }
  }

  const status = overview?.status; const sheets = overview?.sheets ?? [];
  return <section className={card} aria-label="Live Google Sheets">
    <p className="text-xs font-semibold uppercase tracking-widest text-accent">Automatic</p>
    <h2 className="mt-2 text-lg font-semibold text-ink">Live Google Sheets</h2>
    <p className="mt-2 text-sm text-ink-2">New rows in a connected sheet become leads on their own, with the same phone, source and duplicate rules as a file import. Every tab with a contact number and a name column is read, including tabs added later; the headings can sit below a title row. Existing leads keep their ID, calls and follow-ups.</p>
    {!overview && !error && <p role="status" className="mt-4 text-sm text-ink-2">Loading connection…</p>}
    {overview?.keyError && <p role="alert" className="mt-4 text-sm text-red-600">{overview.keyError}</p>}

    {!!sheets.length && <div className="mt-4 space-y-3">
      <ul className="space-y-2">{sheets.map(s => <li key={s.spreadsheetId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-inset p-3 text-sm text-ink">
        <span><a className="font-medium text-accent underline" target="_blank" rel="noreferrer" href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}`}>{s.title || 'Google Sheet'}</a>{s.defaultSource ? ` · blank sources count as ${s.defaultSource}` : ''}<span className="block text-xs text-ink-2">{status?.tabs.filter(t => t.sheet === (s.title || 'Google Sheet')).map(t => `${t.tab} (${t.rows})`).join(' · ') || 'No lead tabs read yet'}</span></span>
        <button className={button} disabled={!!busy} onClick={() => { if (window.confirm(`Stop importing from ${s.title || 'this sheet'}? Leads already imported stay.`)) void apply('Disconnecting…', { action: 'remove', spreadsheetId: s.spreadsheetId }); }}>Disconnect</button>
      </li>)}</ul>
      {status && (status.ok
        ? <p role="status" className="text-sm text-ink-2">Last import {ist(status.at)} IST: {status.added} new · {plural(status.updated, 'existing lead')} updated · {status.duplicates} already imported · {plural(status.invalidCount, 'invalid row')}{status.conflicts ? ` · ${status.conflicts} being edited, retried next time` : ''}{overview?.checkedAt && overview.checkedAt > status.at ? `. Sheets last checked ${ist(overview.checkedAt)}, no changes.` : ''}</p>
        : <p role="alert" className="rounded-xl border border-line bg-inset p-4 text-sm text-red-600">Sync failed at {ist(status.at)} IST: {status.error}</p>)}
      {!!status?.invalid.length && <details className="text-sm text-ink-2"><summary>Review invalid rows ({status.invalidCount})</summary><ul className="mt-2 max-h-48 overflow-auto">{status.invalid.map((e, i) => <li key={i}>{e.where}{e.row ? ` · row ${e.row}` : ''}: {e.reason}</li>)}</ul>{status.invalidCount > status.invalid.length && <p className="mt-1 text-xs text-ink-muted">Showing the first {status.invalid.length}. Rows fixed in the sheet import on the next sync.</p>}</details>}
      <p className="text-xs text-ink-muted">{overview?.intervalMinutes ? `Checked every ${overview.intervalMinutes === 1 ? 'minute' : `${overview.intervalMinutes} minutes`}.` : 'This server has no sync timer; it syncs when its scheduled job calls the cron route.'} Open pages pick up new leads within a minute.</p>
      <button className={primary} disabled={!!busy} onClick={() => void apply('Syncing…', { action: 'sync' })}>Sync now</button>
    </div>}

    {overview && <form className="mt-5 space-y-3 border-t border-line pt-4" onSubmit={e => { e.preventDefault(); void apply('Reading sheet and importing…', { action: 'add', url, defaultSource }); }}>
      <h3 className="font-medium text-ink">{sheets.length ? 'Connect another sheet' : 'Connect a sheet'}</h3>
      <p className="text-sm text-ink-2">{overview.serviceEmail
        ? <>Share the sheet with <span className="break-all font-medium text-ink">{overview.serviceEmail}</span> as a Viewer, then paste its link.</>
        : <>In Google Sheets choose Share → General access → <span className="font-medium text-ink">Anyone with the link</span> (Viewer), then paste the link. Anyone who has that link can read the sheet.</>}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1"><Field label="Google Sheets link"><input required type="url" className={input} placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={e => setUrl(e.target.value)} /></Field></div>
        <Field label="Source when blank"><select className={input} value={defaultSource} onChange={e => setDefaultSource(e.target.value)}><option value="">None</option>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field>
        <button className={primary} disabled={!!busy}>Connect and import</button>
      </div>
      <p className="text-xs text-ink-muted">Dates are read as India time. Choose a source when blank only if the sheet has no source column.</p>
    </form>}
    {busy && <p role="status" className="mt-3 text-sm text-ink-2">{busy}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </section>;
}
