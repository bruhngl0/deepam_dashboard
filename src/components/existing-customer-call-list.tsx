'use client';
import { useEffect, useState } from 'react';
import { formatNumber, formatPhone } from '@/lib/format';
import type { ExistingCustomerFilters, ExistingCustomerKpis, ExistingCustomerListRow, ExistingCustomerView } from '@/lib/marketing/existing-customer-store';
import { button, card, dayMonthYearTimeLabel, Field, input, money, primary } from './marketing-shared';

type Response = { listName: string; total: number; assigned: number; unassigned: number; kpis: ExistingCustomerKpis; stores: string[]; filtered: number; page: number; pageSize: number; rows: ExistingCustomerListRow[] };

export type CallList = 'exhibition' | 'online';

const LIST_TEXT: Record<CallList, { eyebrow: string; title: string; blurb: string; loadError: string }> = {
  exhibition: { eyebrow: 'Existing customers', title: 'Exhibition customer calls', blurb: 'MG Road customers are assigned for calling. This list stays outside lead, campaign, and conversion figures.', loadError: 'Could not load the exhibition customer list.' },
  online: { eyebrow: 'Online customers', title: 'Online customer calls', blurb: 'Shopify customers who were new to the CRM. Customers already in the CRM stay existing customers and are not repeated here.', loadError: 'Could not load the online customer list.' },
};

async function load(page = 0, search = '', view: ExistingCustomerView = 'all', filters: ExistingCustomerFilters = {}, list: CallList = 'exhibition'): Promise<Response> {
  const query = new URLSearchParams({ page: String(page), view, search, from: filters.from ?? '', to: filters.to ?? '', store: filters.store ?? '', list });
  const response = await fetch(`/api/marketing/existing-customers?${query}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(LIST_TEXT[list].loadError);
  return await response.json() as Response;
}

export function ExistingCustomerCallCard({ open }: { open: () => void }) {
  const [data, setData] = useState<Response | null>(null);
  useEffect(() => { void load().then(setData).catch(() => {}); }, []);
  return <section className={card}>
    <p className="text-sm text-ink-2">Existing customer call list</p>
    <p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{data ? formatNumber(data.total) : '…'}</p>
    <p className="mt-2 text-xs text-ink-muted">For exhibition outreach · kept separate from leads</p>
    <button className={`${button} mt-4`} onClick={open}>Open customer list</button>
  </section>;
}

const VIEW_TITLES: Record<ExistingCustomerView, string> = { all: 'All customers', called: 'Customers called', pending: 'Pending calls', interested: 'Interested customers', followups: 'Follow-ups due', converted: 'Converted customers' };

export function ExistingCustomerCallList({ list = 'exhibition' }: { list?: CallList }) {
  const text = LIST_TEXT[list];
  const [data, setData] = useState<Response | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ExistingCustomerView>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [store, setStore] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => void load(page, search, view, { from, to, store }, list).then(value => { if (active) { setData(value); setError(''); } }).catch(e => { if (active) setError((e as Error).message); }), 150);
    return () => { active = false; clearTimeout(timer); };
  }, [page, search, view, from, to, store, list]);
  const open = (next: ExistingCustomerView) => { setView(next); setPage(0); };
  const extra = view === 'followups' ? 'Follow-up due' : view === 'converted' ? 'Billed' : '';
  return <section className="overflow-hidden rounded-2xl border border-line bg-surface">
    <div className="flex flex-wrap items-end justify-between gap-4 p-5">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">{text.eyebrow}</p><h2 className="mt-1 text-xl font-semibold text-ink">{text.title}</h2><p className="mt-1 text-sm text-ink-2">{text.blurb}</p></div>
      <input className={`${input} sm:!w-80`} aria-label={`Search ${text.eyebrow.toLowerCase()}`} placeholder="Name, Contact No., salesperson, store…" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />
    </div>
    <div className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4">
      <Field label="From"><input type="date" className={input} max={to || undefined} value={from} onChange={event => { setFrom(event.target.value); setPage(0); }} /></Field>
      <Field label="To"><input type="date" className={input} min={from || undefined} value={to} onChange={event => { setTo(event.target.value); setPage(0); }} /></Field>
      <Field label="Store"><select className={input} value={store} onChange={event => { setStore(event.target.value); setPage(0); }}><option value="">All stores</option>{(data?.stores ?? (store ? [store] : [])).map(name => <option key={name}>{name}</option>)}</select></Field>
      <button className={button} onClick={() => { setFrom(''); setTo(''); setStore(''); setPage(0); }}>Clear filters</button>
      <p className="w-full text-xs text-ink-muted">Dates narrow Customers called, Interested and Converted to calls and bills in that period, and Follow-ups due to those falling due in it. Customers and Pending calls are today&apos;s totals. All times IST.</p>
    </div>
    {data && <Kpis kpis={data.kpis} view={view} open={open} />}
    {error && <p role="alert" className="p-5 text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><h3 className="text-base font-semibold text-ink">{VIEW_TITLES[view]}{data && <span className="ml-2 font-normal text-ink-muted">{formatNumber(data.filtered)}</span>}</h3>{view !== 'all' && <button className={button} onClick={() => open('all')}>Show all customers</button>}</div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Customer', 'Contact No.', 'Store', 'City', 'Assignment', 'Last call', 'Outcome', ...(extra ? [extra] : [])].map(heading => <th key={heading} className="whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead><tbody>{data?.rows.map(row => <tr key={row.id} className="border-t border-line align-top text-ink"><td className="px-4 py-3 font-medium">{row.name}{row.sourceCustomerId && <p className="mt-1 text-xs font-normal text-ink-muted">Old customer no. {row.sourceCustomerId}</p>}</td><td className="whitespace-nowrap px-4 py-3">{formatPhone(row.phone)}</td><td className="px-4 py-3">{row.branch || '—'}</td><td className="px-4 py-3 text-ink-2">{row.city || '—'}</td><td className="px-4 py-3">{row.assignedTo || <span className="text-ink-muted">Unassigned</span>}</td><td className="whitespace-nowrap px-4 py-3">{row.lastCalledAt ? dayMonthYearTimeLabel(row.lastCalledAt) : <span className="text-ink-muted">Not called</span>}</td><td className="min-w-40 px-4 py-3">{row.lastOutcome || '—'}{row.lastNote && <p className="mt-1 text-xs text-ink-muted">{row.lastNote}</p>}</td>{view === 'followups' && <td className="min-w-40 px-4 py-3">{row.followupDue ? dayMonthYearTimeLabel(row.followupDue) : '—'}{row.followupNote && <p className="mt-1 text-xs text-ink-muted">{row.followupNote}</p>}</td>}{view === 'converted' && <td className="whitespace-nowrap px-4 py-3">{row.billed === null ? '—' : money(row.billed)}</td>}</tr>)}</tbody></table></div>
    {data && !data.rows.length && <p className="p-10 text-center text-sm text-ink-muted">{search ? 'No customers in this view match this search.' : 'No customers in this view yet.'}</p>}
    {data && <div className="flex items-center justify-between border-t border-line p-4 text-sm text-ink-2"><span>{formatNumber(data.filtered)} customers · Page {data.page + 1} of {Math.max(1, Math.ceil(data.filtered / data.pageSize))}</span><div className="flex gap-2"><button className={button} disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><button className={primary} disabled={(page + 1) * data.pageSize >= data.filtered} onClick={() => setPage(page + 1)}>Next</button></div></div>}
  </section>;
}

const share = (part: number, whole: number) => whole ? `${Math.round(part / whole * 100)}%` : '0%';

function Kpis({ kpis, view, open }: { kpis: ExistingCustomerKpis; view: ExistingCustomerView; open: (view: ExistingCustomerView) => void }) {
  const cards: [ExistingCustomerView, string, string, string][] = [
    ['all', 'Customers', formatNumber(kpis.total), `${formatNumber(kpis.assigned)} assigned · ${formatNumber(kpis.total - kpis.assigned)} unassigned`],
    ['called', 'Customers called', formatNumber(kpis.called), `${share(kpis.called, kpis.total)} of the list · ${formatNumber(kpis.calls)} calls logged`],
    ['pending', 'Pending calls', formatNumber(kpis.pending), 'Assigned and not yet called'],
    ['interested', 'Interested', formatNumber(kpis.interested), `${share(kpis.interested, kpis.called)} of called · ${formatNumber(kpis.connected)} connected`],
    ['followups', 'Follow-ups due', formatNumber(kpis.followups), `${formatNumber(kpis.overdue)} overdue`],
    ['converted', 'Converted', formatNumber(kpis.converted), `${money(kpis.revenue)} billed after being claimed`],
  ];
  return <div className="grid gap-3 border-y border-line bg-inset/40 p-4 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([id, label, value, note]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => open(id)} className={`${card} text-left hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${view === id ? '!border-accent ring-1 ring-accent' : ''}`}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p><p className="mt-2 text-xs text-ink-muted">{note}</p></button>)}</div>;
}
