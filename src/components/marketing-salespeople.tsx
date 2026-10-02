'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { callLog, OUTCOMES, readDataset, type CallEntry, type Dataset } from '@/lib/marketing/local';
import { button, card, dateLabel, Field, input } from './marketing-shared';

const PAGE = 25;
/** Calls logged from the salesperson desk live under their own storage key in this browser. */
/** Always offered in the filter, even before they have logged a call. */
const KNOWN_SALESPEOPLE = ['Abishek'];
const DESK_KEYS = ['marketing-local-v1:salesperson:abishek'];

export function MarketingSalespeople({ data }: { data: Dataset }) {
  const [desks, setDesks] = useState<Dataset[]>([]);
  const [stored, setStored] = useState<CallEntry[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [person, setPerson] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [outcome, setOutcome] = useState(''); const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const load = () => setDesks(DESK_KEYS.flatMap(k => { try { const raw = localStorage.getItem(k); return raw ? [readDataset(raw)] : []; } catch { return []; } }));
    load();
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, []);

  useEffect(() => {
    fetch('/api/marketing/calls', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(j => { setStored(j.calls); setLoadError(false); }).catch(() => setLoadError(true));
  }, []);

  const all = callLog([data, ...desks], stored);
  const people = [...new Set([...KNOWN_SALESPEOPLE, ...all.map(c => c.salesperson)])].sort();
  const q = search.trim().toLowerCase();
  const rows = all.filter(c => (!person || c.salesperson === person) && (!from || c.at.slice(0, 10) >= from) && (!to || c.at.slice(0, 10) <= to) && (!outcome || c.outcome === outcome)
    && (!q || c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.note.toLowerCase().includes(q)));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE) - 1));
  const customers = new Set(rows.map(c => c.leadId)).size;
  const days = new Set(rows.map(c => c.at.slice(0, 10))).size;
  const count = (o: string) => rows.filter(c => c.outcome.startsWith(o)).length;
  const perPerson = people.map(p => ({ p, n: rows.filter(c => c.salesperson === p).length })).filter(x => x.n);
  const reset = () => { setPerson(''); setFrom(''); setTo(''); setOutcome(''); setSearch(''); setPage(0); };
  const on = (fn: (v: string) => void) => (e: { target: { value: string } }) => { fn(e.target.value); setPage(0); };

  return <div className="space-y-5">
    <section aria-label="Salesperson filters" className={`${card} flex flex-wrap items-end gap-3`}>
      <Field label="Salesperson"><select className={input} value={person} onChange={on(setPerson)}><option value="">All salespeople</option>{people.map(p => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Calls from"><input type="date" className={input} max={to || undefined} value={from} onChange={on(setFrom)} /></Field>
      <Field label="Calls to"><input type="date" className={input} min={from || undefined} value={to} onChange={on(setTo)} /></Field>
      <Field label="Outcome"><select className={input} value={outcome} onChange={on(setOutcome)}><option value="">All outcomes</option>{OUTCOMES.map(o => <option key={o}>{o}</option>)}</select></Field>
      <Field label="Search"><input className={input} placeholder="Customer, number, note…" value={search} onChange={on(setSearch)} /></Field>
      <button className={button} onClick={reset}>Clear filters</button>
      {from && to && from > to && <p role="alert" className="w-full text-sm text-red-600">From must be on or before To.</p>}
    </section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[
      ['Calls logged', rows.length], ['Customers called', customers], ['Days with calls', days], ['Connected', count('Connected')], ['Interested', count('Connected / interested')], ['No answer', count('No answer')],
    ].map(([label, value]) => <div className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</p></div>)}</div>
    {!person && perPerson.length > 0 && <section className={card}><h2 className="text-lg font-semibold text-ink">Calls by salesperson</h2><div className="mt-3 flex flex-wrap gap-2">{perPerson.map(({ p, n }) => <button key={p} className={button} onClick={() => { setPerson(p); setPage(0); }}>{p} · {n}</button>)}</div></section>}
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="p-4"><h2 className="text-lg font-semibold text-ink">{person ? `${person}'s call log` : 'Call log'}</h2><p className="text-xs text-ink-muted">Every call logged from the calling queue, from any browser, newest first. Times are IST.</p>{loadError && <p role="alert" className="mt-1 text-xs text-red-600">Could not load the shared call log; showing calls saved in this browser only.</p>}</div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Customer', 'Phone', 'Call logged at', 'Outcome', 'Note', 'Logged by'].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
        <tbody>{rows.slice(currentPage * PAGE, currentPage * PAGE + PAGE).map(c => <tr key={c.id} className="border-t border-line align-top text-ink">
          <td className="px-4 py-3"><Link href={`/crm/marketing/leads/${c.leadId}`} className="font-semibold text-accent hover:underline">{c.name}</Link></td>
          <td className="whitespace-nowrap px-4 py-3 text-ink-2">{c.phone}</td><td className="whitespace-nowrap px-4 py-3 text-ink-2">{dateLabel(c.at)}</td>
          <td className="px-4 py-3">{c.outcome || '—'}</td><td className="min-w-48 px-4 py-3 text-ink-2">{c.note}</td><td className="px-4 py-3">{c.salesperson}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className="p-10 text-center text-sm text-ink-muted">No logged calls match these filters.</p>}
      <div className="flex items-center justify-between border-t border-line p-4 text-sm text-ink-2"><span>{rows.length} calls · Page {currentPage + 1} of {Math.max(1, Math.ceil(rows.length / PAGE))}</span><div className="flex gap-2"><button className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><button className={button} disabled={(currentPage + 1) * PAGE >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
    </section>
  </div>;
}
