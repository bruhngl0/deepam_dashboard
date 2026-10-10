'use client';
import { useEffect, useState } from 'react';
import { callLog, OUTCOMES, salespersonPerformance, type CallEntry, type Dataset } from '@/lib/marketing/local';
import { SALESPEOPLE } from '@/lib/salespeople';
import { button, card, Field, input, money } from './marketing-shared';

const KNOWN_SALESPEOPLE = SALESPEOPLE.map(({ name }) => name);

export function MarketingSalespeople({ data }: { data: Dataset }) {
  const [stored, setStored] = useState<CallEntry[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [person, setPerson] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [outcome, setOutcome] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/marketing/calls', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(result => { setStored(result.calls); setLoadError(false); })
      .catch(() => setLoadError(true));
  }, []);

  const all = callLog([data], stored);
  const people = [...new Set([...KNOWN_SALESPEOPLE, ...all.map(call => call.salesperson)])].sort();
  const query = search.trim().toLowerCase();
  const filteredCalls = all.filter(call => (!from || call.at.slice(0, 10) >= from) && (!to || call.at.slice(0, 10) <= to) && (!outcome || call.outcome === outcome)
    && (!query || call.name.toLowerCase().includes(query) || call.phone.includes(query) || call.note.toLowerCase().includes(query)));
  const performance = salespersonPerformance(data, filteredCalls, person ? [person] : people);
  const reset = () => { setPerson(''); setFrom(''); setTo(''); setOutcome(''); setSearch(''); };

  return <div className="space-y-5">
    <section aria-label="Salesperson filters" className={`${card} flex flex-wrap items-end gap-3`}>
      <Field label="Salesperson"><select className={input} value={person} onChange={event => setPerson(event.target.value)}><option value="">All salespeople</option>{people.map(name => <option key={name}>{name}</option>)}</select></Field>
      <Field label="Calls from"><input type="date" className={input} max={to || undefined} value={from} onChange={event => setFrom(event.target.value)} /></Field>
      <Field label="Calls to"><input type="date" className={input} min={from || undefined} value={to} onChange={event => setTo(event.target.value)} /></Field>
      <Field label="Outcome"><select className={input} value={outcome} onChange={event => setOutcome(event.target.value)}><option value="">All outcomes</option>{OUTCOMES.map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Search"><input className={input} placeholder="Customer, number, note…" value={search} onChange={event => setSearch(event.target.value)} /></Field>
      <button className={button} onClick={reset}>Clear filters</button>
      {from && to && from > to && <p role="alert" className="w-full text-sm text-red-600">From must be on or before To.</p>}
    </section>
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="p-4"><h2 className="text-lg font-semibold text-ink">Performance</h2><p className="text-xs text-ink-muted">Claimed is assigned leads, Called is assigned leads with a logged call, and Pending is assigned leads not yet called.</p>{loadError && <p role="alert" className="mt-1 text-xs text-red-600">Could not load the shared call records; showing activity stored on current leads.</p>}</div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Salesperson name', 'Claimed', 'Called', 'Pending', 'Interested', 'Converted', 'Revenue'].map(heading => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody>{performance.map(row => <tr key={row.salesperson} className="border-t border-line text-ink"><td className="px-4 py-3 font-semibold">{row.salesperson}</td><td className="px-4 py-3">{row.claimed}</td><td className="px-4 py-3">{row.called}</td><td className="px-4 py-3">{row.pending}</td><td className="px-4 py-3">{row.interested}</td><td className="px-4 py-3">{row.converted}</td><td className="px-4 py-3">{money(row.revenue)}</td></tr>)}</tbody></table></div>
      {!performance.length && <p className="p-10 text-center text-sm text-ink-muted">No salesperson performance matches these filters.</p>}
    </section>
  </div>;
}
