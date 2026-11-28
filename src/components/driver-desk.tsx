'use client';
import { useCallback, useEffect, useState } from 'react';
import { OUTCOMES, type Outcome } from '@/lib/marketing/local';
import { DRIVER_VIEWS, type DriverDesk as Desk, type DriverRow, type DriverView } from '@/lib/marketing/driver-views';
import { button, card, input, primary } from './marketing-shared';
import { textButton } from './ui';

/**
 * The drivers desk. "marketing": Marketing → Drivers, which can also add drivers; calls are logged as the Marketing
 * team. "sales": the Drivers tab on a salesperson's calling desk, calls logged under their name. Either way the list
 * is shared and open: nobody claims a driver, and it refreshes every minute so everyone sees the latest calls.
 */
export function DriverDesk({ mode }: { mode: 'marketing' | 'sales' }) {
  const api = mode === 'sales' ? '/sales/api/drivers' : '/api/marketing/drivers';
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<DriverView>('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ view, page: String(page), ...(search.trim() ? { search: search.trim() } : {}) });
    const response = await fetch(`${api}?${qs}`, { cache: 'no-store' }).catch(() => null);
    if (!response?.ok) { setError('Could not load the drivers. Try again.'); return; }
    setDesk(await response.json() as Desk); setError('');
  }, [api, view, page, search]);

  useEffect(() => {
    const first = setTimeout(load, search ? 250 : 0);
    const timer = setInterval(load, 60_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [load, search]);

  const kpis: [string, number | null | undefined][] = [
    ['Drivers', desk?.total], ['Not called yet', desk?.notCalled], ['Called', desk?.called], ['Calls today', desk?.callsToday],
    ...(mode === 'sales' ? [['My calls today', desk?.myCallsToday] as [string, number | null | undefined]] : []),
  ];
  const pages = desk ? Math.max(1, Math.ceil(desk.filtered / desk.pageSize)) : 1;

  return <div className="space-y-5">
    <section className="space-y-1">
      <h2 className="text-lg font-semibold text-ink">Drivers</h2>
      <p className="text-xs text-ink-muted">An open list: anyone can call any driver. Log every call so the next person sees who spoke to them and what came of it. Drivers nobody has called come first.</p>
    </section>
    <div className={`grid gap-3 sm:grid-cols-2 ${mode === 'sales' ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {kpis.map(([label, value]) => <div key={label} className={card}><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">{label}</p><p className="tnum mt-2 text-3xl font-semibold leading-none tracking-tight text-ink">{value ?? '…'}</p></div>)}
    </div>
    {mode === 'marketing' && <AddDrivers api={api} onAdded={load} />}
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="space-y-3 p-4">
        <nav className="flex flex-wrap gap-2" aria-label="Driver views">{DRIVER_VIEWS.map(v => <button key={v} className={v === view ? primary : button} aria-current={v === view ? 'page' : undefined} onClick={() => { setView(v); setPage(0); }}>{v}</button>)}</nav>
        <input className={input} aria-label="Search drivers" placeholder="Search name or number..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="space-y-2 border-t border-line p-3 sm:p-4">
        {desk?.rows.map(driver => <DriverCard key={driver.id} driver={driver} api={api} onSaved={load} />)}
        {desk && !desk.rows.length && <p className="p-8 text-center text-sm text-ink-muted">{desk.total ? 'No drivers match.' : 'No drivers on the list yet.'}</p>}
        {!desk && !error && <p role="status" className="p-8 text-center text-sm text-ink-muted">Loading drivers…</p>}
      </div>
      {desk && desk.filtered > desk.pageSize && <div className="flex items-center justify-between gap-3 border-t border-line p-3 text-sm text-ink-2">
        <button className={button} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
        <span className="tnum">Page {page + 1} of {pages} · {desk.filtered} drivers</span>
        <button className={button} disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>}
    </section>
  </div>;
}

const when = (at: string) => at.replace('T', ' ');

function DriverCard({ driver, api, onSaved }: { driver: DriverRow; api: string; onSaved: () => Promise<void> }) {
  const [logging, setLogging] = useState(false);
  const [history, setHistory] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const wa = `https://wa.me/91${driver.phone.replace(/\D/g, '').slice(-10)}`;

  async function save() {
    if (!outcome) { setError('Choose how the call went.'); return; }
    setSaving(true); setError('');
    const response = await fetch(`${api}/${driver.id}/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome, note }) }).catch(() => null);
    setSaving(false);
    if (!response?.ok) { setError((await response?.json().catch(() => null) as { error?: string } | null)?.error ?? 'Could not save the call. Try again.'); return; }
    setLogging(false); setOutcome(''); setNote('');
    await onSaved();
  }

  return <article className="rounded-xl border border-line bg-surface px-3 py-2.5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold text-ink">{driver.name}</h3>
        <a href={`tel:+91${driver.phone}`} className="tnum text-sm text-accent">{driver.phone}</a>
        {driver.last
          ? <p className="mt-1 text-xs text-ink-2">Last call {when(driver.last.calledAt)} by <span className="font-medium">{driver.last.caller}</span> · {driver.last.outcome}{driver.last.note ? ` · ${driver.last.note}` : ''}</p>
          : <p className="mt-1 text-xs text-ink-muted">Not called yet</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={`tel:+91${driver.phone}`} className={button}>Call</a>
        <a href={wa} target="_blank" rel="noreferrer" className={button}>WhatsApp</a>
        <button className={primary} onClick={() => { setLogging(v => !v); setError(''); }}>Log call</button>
      </div>
    </div>
    {driver.calls > 1 && <button className={`${textButton} -ml-3 mt-1 text-xs`} onClick={() => setHistory(v => !v)}>{history ? 'Hide calls' : `All calls (${driver.calls})`}</button>}
    {history && <ul className="mt-1 space-y-1 text-xs text-ink-2">{driver.recent.map((c, i) => <li key={i}>{when(c.calledAt)} · {c.caller} · {c.outcome}{c.note ? ` · ${c.note}` : ''}</li>)}{driver.calls > driver.recent.length && <li className="text-ink-muted">and {driver.calls - driver.recent.length} earlier</li>}</ul>}
    {logging && <div className="mt-3 grid gap-2 rounded-xl bg-inset/50 p-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]">
      <select className={input} aria-label="Call outcome" value={outcome} onChange={e => setOutcome(e.target.value as Outcome)}><option value="">How did the call go?</option>{OUTCOMES.map(o => <option key={o}>{o}</option>)}</select>
      <input className={input} aria-label="Note" placeholder="Note (optional)" value={note} maxLength={2000} onChange={e => setNote(e.target.value)} />
      <div className="flex gap-2"><button className={primary} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button><button className={button} onClick={() => setLogging(false)}>Cancel</button></div>
      {error && <p role="alert" className="text-sm text-red-600 sm:col-span-3">{error}</p>}
    </div>}
  </article>;
}

function AddDrivers({ api, onAdded }: { api: string; onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added?: number; existing?: number; error?: string; skipped?: { line: string; reason: string }[] } | null>(null);

  async function add() {
    setBusy(true); setResult(null);
    const response = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => null);
    const value = await response?.json().catch(() => null) ?? { error: 'Could not add the drivers. Try again.' };
    setBusy(false); setResult(value);
    if (response?.ok) { setText(''); await onAdded(); }
  }

  if (!open) return <button className={button} onClick={() => setOpen(true)}>Add drivers</button>;
  return <section className={`${card} space-y-3`}>
    <div><h3 className="font-semibold text-ink">Add drivers</h3><p className="text-xs text-ink-muted">Paste one driver per line as &ldquo;Name - number&rdquo;. A number already on the list is left as it is.</p></div>
    <textarea className={`${input} min-h-40 font-mono`} aria-label="Drivers to add" placeholder={'Ravi - 9845000000\nSuresh - 9900000000'} value={text} onChange={e => setText(e.target.value)} />
    <div className="flex flex-wrap items-center gap-2"><button className={primary} disabled={busy || !text.trim()} onClick={add}>{busy ? 'Adding…' : 'Add to the list'}</button><button className={button} onClick={() => { setOpen(false); setResult(null); }}>Close</button></div>
    {result && <div role="status" className="space-y-1 text-sm text-ink-2">
      {result.error ? <p className="text-red-600">{result.error}</p> : <p>{result.added} added{result.existing ? `, ${result.existing} already on the list` : ''}.</p>}
      {!!result.skipped?.length && <><p>{result.skipped.length} line{result.skipped.length === 1 ? '' : 's'} skipped:</p><ul className="list-disc pl-5 text-xs">{result.skipped.map((s, i) => <li key={i}>{s.line}: {s.reason}</li>)}</ul></>}
    </div>}
  </section>;
}
