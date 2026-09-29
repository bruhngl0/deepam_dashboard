'use client';
import Link from 'next/link';
import { useState } from 'react';
import { convertedLeads, filterLeads, nowLocal, type Lead } from '@/lib/marketing/local';
import { button, card, dateLabel, input, primary, useMarketing } from './marketing-shared';
import { LeadActions } from './marketing-lead-actions';

type SalesTab = 'Calling queue' | 'Follow-ups';

export function SalespersonMarketingWorkspace() {
  const { data, save, message } = useMarketing('salesperson:abishek');
  const [tab, setTab] = useState<SalesTab>('Calling queue');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  if (!data) return <p role="status" className="p-8 text-ink-2">{message || 'Loading calling workspace...'}</p>;

  const convertedPhones = new Set(convertedLeads(data).map(l => l.phone));
  const queue = data.leads.filter(l => !convertedPhones.has(l.phone) && !['Connected / not interested', 'Wrong number'].includes(l.status));
  const visible = filterLeads(queue, { from: '', to: '', store: '', source: '', search });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 20) - 1));
  const now = nowLocal().slice(0, 16);
  const today = nowLocal().slice(0, 10);
  const pending = data.leads.flatMap(lead => lead.followups.filter(f => !f.completedAt).map(f => ({ lead, followup: f }))).sort((a, b) => a.followup.due.localeCompare(b.followup.due));
  const update = (lead: Lead) => save({ ...data, leads: data.leads.map(l => l.id === lead.id ? lead : l) });

  function changeTab(next: SalesTab) {
    setTab(next);
    setPage(0);
    setSearch('');
  }

  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Salesperson workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Abishek calling desk</h1><p className="mt-2 text-sm text-ink-2">Calling queue and follow-ups only.</p></div><span className="rounded-full bg-inset px-3 py-2 text-xs text-ink-2">Local browser records</span></header>
    {message && <p role="status" className={`${card} text-sm text-ink`}>{message}</p>}
    <nav className="flex flex-wrap gap-2 border-b border-line pb-3" aria-label="Salesperson sections">
      {(['Calling queue', 'Follow-ups'] as const).map(t => <button key={t} className={tab === t ? primary : button} aria-current={tab === t ? 'page' : undefined} onClick={() => changeTab(t)}>{t}{t === 'Calling queue' ? ` (${queue.length})` : ` (${pending.length})`}</button>)}
    </nav>
    {tab === 'Calling queue' && <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="text-lg font-semibold text-ink">Calling queue</h2><p className="text-xs text-ink-muted">Logged calls turn green for quick tracking.</p></div><input className={`${input} sm:!w-80`} aria-label="Search leads" placeholder="Name, number, lead ID, campaign..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Lead / contact', 'Sources / campaign', 'Date-Time', 'Preferred store', 'Call status', 'Actions', 'Log call'].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{visible.slice(currentPage * 20, currentPage * 20 + 20).map(l => <tr key={l.id} className="border-t border-line align-top"><td className="min-w-48 px-4 py-4"><span className="font-semibold text-ink">{l.name}</span><p className="mt-1 text-ink-2">{l.phone}</p><p className="text-xs text-ink-muted">{l.email || 'Email not recorded'}</p><p className="mt-1 max-w-48 break-all text-[10px] text-ink-muted">{l.id}</p></td><td className="min-w-40 px-4 py-4 text-ink">{[...new Set(l.acquisitions.map(a => a.source))].join(', ')}<p className="mt-1 text-xs text-ink-2">{[...new Set(l.acquisitions.map(a => a.campaignId).filter(Boolean))].join(', ') || 'No campaign'}</p></td><td className="whitespace-nowrap px-4 py-4 text-ink-2">{dateLabel(l.acquiredAt)}</td><td className="px-4 py-4 text-ink-2">{l.preferredStore || 'Not recorded'}</td><td className="px-4 py-4 text-ink-2">{l.interactions.some(i => i.type === 'call') ? 'Logged' : 'Pending call'}</td><td className="min-w-72 px-4 py-4"><LeadActions lead={l} update={update} /></td><td className="min-w-36 px-4 py-4"><LeadActions lead={l} update={update} variant="call-only" /></td></tr>)}</tbody></table></div>
      {!visible.length && <p className="p-10 text-center text-sm text-ink-muted">No leads match this view.</p>}
      <div className="flex items-center justify-between border-t border-line p-4 text-sm text-ink-2"><span>{visible.length} leads · Page {currentPage + 1} of {Math.max(1, Math.ceil(visible.length / 20))}</span><div className="flex gap-2"><button className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><button className={button} disabled={(currentPage + 1) * 20 >= visible.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
    </section>}
    {tab === 'Follow-ups' && <div className="grid items-start gap-4 lg:grid-cols-3">{['Overdue', 'Today', 'Upcoming'].map(bucket => {
      const entries = pending.filter(p => bucket === 'Overdue' ? p.followup.due < now : bucket === 'Today' ? p.followup.due >= now && p.followup.due.startsWith(today) : p.followup.due.slice(0, 10) > today);
      return <section key={bucket} className={card}><h2 className="text-lg font-semibold text-ink">{bucket} <span className="text-ink-muted">{entries.length}</span></h2><div className="mt-4 space-y-4">{entries.map(({ lead, followup: f }) => <div key={f.id} className="rounded-xl border border-line p-4"><Link href={`tel:${lead.phone}`} className="font-medium text-accent">{lead.name}</Link><p className="mt-1 text-xs text-ink-muted">{dateLabel(f.due)}</p><p className="my-3 text-sm text-ink-2">{f.note || 'Follow up with customer'}</p><LeadActions lead={lead} update={update} /><button className={`${button} mt-2`} onClick={() => update({ ...lead, followups: lead.followups.map(x => x.id === f.id ? { ...x, completedAt: nowLocal() } : x), interactions: [...lead.interactions, { id: crypto.randomUUID(), at: nowLocal(), type: 'followup', text: `Follow-up completed: ${f.note}` }] })}>Complete</button></div>)}{!entries.length && <p className="text-sm text-ink-muted">No follow-ups.</p>}</div></section>;
    })}</div>}
  </main>;
}
