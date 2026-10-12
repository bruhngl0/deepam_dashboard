'use client';
import { useEffect, useState } from 'react';
import { formatNumber, formatPhone } from '@/lib/format';
import { button, card, input, primary } from './marketing-shared';

type Row = { id: number; sourceCustomerId: string | null; name: string; phone: string; branch: string; city: string; assignedTo: string | null };
type Response = { listName: string; total: number; assigned: number; unassigned: number; filtered: number; page: number; pageSize: number; rows: Row[] };

async function load(page = 0, search = ''): Promise<Response> {
  const response = await fetch(`/api/marketing/existing-customers?page=${page}&search=${encodeURIComponent(search)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the exhibition customer list.');
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

export function ExistingCustomerCallList() {
  const [data, setData] = useState<Response | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => void load(page, search).then(value => { if (active) { setData(value); setError(''); } }).catch(e => { if (active) setError((e as Error).message); }), 150);
    return () => { active = false; clearTimeout(timer); };
  }, [page, search]);
  return <section className="overflow-hidden rounded-2xl border border-line bg-surface">
    <div className="flex flex-wrap items-end justify-between gap-4 p-5">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Existing customers</p><h2 className="mt-1 text-xl font-semibold text-ink">Exhibition customer calls</h2><p className="mt-1 text-sm text-ink-2">MG Road customers are assigned for calling. This list stays outside lead, campaign, and conversion figures.</p></div>
      <input className={`${input} sm:!w-80`} aria-label="Search existing customers" placeholder="Name, phone, salesperson, branch…" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />
    </div>
    {data && <div className="grid gap-3 border-y border-line bg-inset/40 p-4 sm:grid-cols-3">{[['Customers', data.total], ['Assigned', data.assigned], ['Unassigned', data.unassigned]].map(([label, value]) => <div key={label}><p className="text-xs text-ink-muted">{label}</p><p className="mt-1 text-xl font-semibold text-ink">{formatNumber(value)}</p></div>)}</div>}
    {error && <p role="alert" className="p-5 text-sm text-red-600">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Customer', 'Phone', 'Customer type', 'Branch', 'City', 'Assignment'].map(heading => <th key={heading} className="whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead><tbody>{data?.rows.map(row => <tr key={row.id} className="border-t border-line text-ink"><td className="px-4 py-3 font-medium">{row.name}{row.sourceCustomerId && <p className="mt-1 text-xs font-normal text-ink-muted">{row.sourceCustomerId}</p>}</td><td className="whitespace-nowrap px-4 py-3">{formatPhone(row.phone)}</td><td className="px-4 py-3 text-ink-2">Existing customer</td><td className="px-4 py-3">{row.branch || '—'}</td><td className="px-4 py-3 text-ink-2">{row.city || '—'}</td><td className="px-4 py-3">{row.assignedTo || <span className="text-ink-muted">Unassigned</span>}</td></tr>)}</tbody></table></div>
    {data && !data.rows.length && <p className="p-10 text-center text-sm text-ink-muted">No existing customers match this search.</p>}
    {data && <div className="flex items-center justify-between border-t border-line p-4 text-sm text-ink-2"><span>{formatNumber(data.filtered)} customers · Page {data.page + 1} of {Math.max(1, Math.ceil(data.filtered / data.pageSize))}</span><div className="flex gap-2"><button className={button} disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><button className={primary} disabled={(page + 1) * data.pageSize >= data.filtered} onClick={() => setPage(page + 1)}>Next</button></div></div>}
  </section>;
}
