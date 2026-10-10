'use client';
import Link from 'next/link';
import { useState } from 'react';
import { commitPreview, convertedLeads, filterLeads, guessMapping, hasLoggedCall, metrics, nowLocal, previewRows, SOURCES, STORES, uid, type Dataset, type Lead } from '@/lib/marketing/local';
import { button, card, dateLabel, Field, input, money, primary, useMarketing } from './marketing-shared';
import { MarketingSalespeople } from './marketing-salespeople';
import { MarketingImport } from './marketing-import';
import { LeadActions } from './marketing-lead-actions';

type Tab = 'Overview' | 'All leads' | 'Calling queue' | 'Follow-ups' | 'Team performance' | 'Campaigns' | 'Import';
const tabs = [
  { id: 'Overview', label: 'Overview' },
  { id: 'All leads', label: 'All leads' },
  { id: 'Calling queue', label: 'Queue' },
  { id: 'Follow-ups', label: 'Follow-ups' },
  { id: 'Team performance', label: 'Team performance' },
  { id: 'Campaigns', label: 'Campaigns' },
] as const satisfies readonly { id: Tab; label: string }[];
export function MarketingWorkspace() {
  const { data, save, message, refresh } = useMarketing();
  const [tab, setTab] = useState<Tab>('Overview');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [store, setStore] = useState(''); const [source, setSource] = useState(''); const [search, setSearch] = useState('');
  const [page, setPage] = useState(0); const [add, setAdd] = useState(false);
  if (!data) return <p role="status" className="p-8 text-ink-2">{message || 'Loading marketing workspace…'}</p>;
  const scope = filterLeads(data.leads, { from, to, store, source, search: '' });
  const matched = convertedLeads(data); const convertedPhones = new Set(matched.map(l => l.phone));
  const stats = metrics(data, scope);
  const queue = scope.filter(l => !hasLoggedCall(l) && !convertedPhones.has(l.phone) && !['Connected / not interested', 'Wrong number'].includes(l.status));
  const today = nowLocal().slice(0, 10); const now = nowLocal().slice(0, 16);
  const pending = scope.flatMap(lead => lead.followups.filter(f => !f.completedAt).map(f => ({ lead, followup: f }))).sort((a, b) => a.followup.due.localeCompare(b.followup.due));
  const overdue = pending.filter(p => p.followup.due < now);
  const subset = tab === 'Calling queue' ? queue : scope;
  const visible = filterLeads(subset, { from: '', to: '', store: '', source: '', search });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 20) - 1));
  const update = (lead: Lead) => save({ ...data, leads: data.leads.map(l => l.id === lead.id ? lead : l) });
  const showLeadActions = tab !== 'All leads';
  function changeTab(next: Tab) { setTab(next); setPage(0); setSearch(''); }
  const costNote = `${stats.costsKnown}/${stats.costsTotal} acquisition records have costs`;
  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Marketing · Customer relationships</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Every lead. Every conversation.</h1><p className="mt-2 text-sm text-ink-2">One customer profile from acquisition to follow-up and purchase.</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-inset px-3 py-2 text-xs text-ink-2">Shared records · {data.leads.length} leads</span><button className={primary} onClick={() => setAdd(!add)}>Add lead</button><button className={button} onClick={() => changeTab('Import')}>Import Excel</button></div></header>
    <p className="text-xs text-ink-muted">Leads and bills are shared by every desk and refresh automatically. Leads can arrive from a connected Google Sheet; no live POS sync is connected. Calls, WhatsApp and email open your apps; you record outcomes here.</p>
    {message && <p role="status" className={`${card} text-sm text-ink`}>{message}</p>}
    {add && <AddLead data={data} save={save} close={() => setAdd(false)} />}
    <section aria-label="Marketing filters" className={`${card} flex flex-wrap items-end gap-3`}>
      <Field label="Date-Time From"><input type="date" className={input} max={to || undefined} value={from} onChange={e => { setFrom(e.target.value); setPage(0); }} /></Field>
      <Field label="Date-Time To"><input type="date" className={input} min={from || undefined} value={to} onChange={e => { setTo(e.target.value); setPage(0); }} /></Field>
      <Field label="Preferred store"><select className={input} value={store} onChange={e => { setStore(e.target.value); setPage(0); }}><option value="">All stores</option>{STORES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <Field label="Source"><select className={input} value={source} onChange={e => { setSource(e.target.value); setPage(0); }}><option value="">All sources</option>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field>
      <button className={button} onClick={() => { setFrom(''); setTo(''); setStore(''); setSource(''); setPage(0); }}>Clear filters</button>
      <p className="w-full text-xs text-ink-muted">Filters select leads by lead date and preferred store. Sales and purchases include their full imported history. All times IST.</p>
      {from && to && from > to && <p role="alert" className="text-sm text-red-600">From must be on or before To.</p>}
    </section>
    <nav className="flex flex-wrap gap-2 border-b border-line pb-3" aria-label="Marketing sections">{tabs.map(({ id, label }) => <button key={id} className={tab === id ? primary : button} aria-current={tab === id ? 'page' : undefined} onClick={() => changeTab(id)}>{label}{id === 'Calling queue' ? ` (${queue.length})` : id === 'Follow-ups' ? ` (${pending.length})` : ''}</button>)}</nav>
    {tab === 'Overview' && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Total leads', String(stats.total), 'Unique phone numbers'], ['Contacted', String(stats.contacted), 'At least one connected call'], ['Interested', String(stats.interested), 'Latest call marked interested'], ['Store visits', String(stats.visits), 'Unique leads with recorded visits'], ['Converted customers', String(stats.converted), 'At least one matched bill'], ['Lead revenue', money(stats.revenue), `${stats.orders} matched bills`], ['Conversion rate', `${stats.conversion.toFixed(1)}%`, 'Converted ÷ unique leads'], ['Cost per acquisition', stats.cpa === null ? 'Not available' : money(stats.cpa), `${costNote}${stats.costsKnown < stats.costsTotal ? ' · partial' : ''}`],
      ].map(([label, value, note]) => <div className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p><p className="mt-2 text-xs text-ink-muted">{note}</p></div>)}</div>
      <div className="grid gap-5 lg:grid-cols-2"><section className={card}><h2 className="text-lg font-semibold text-ink">Your next conversations</h2><p className="mt-1 text-sm text-ink-2">{overdue.length} overdue · {pending.filter(p => p.followup.due.startsWith(today)).length} due today · {queue.length} active leads</p><div className="mt-5 space-y-3">{pending.slice(0, 4).map(({ lead, followup: f }) => <Link key={f.id} href={`/marketing/leads/${lead.id}`} className="block rounded-xl bg-inset p-3 text-sm text-ink"><p className="font-medium">{lead.name}</p><p className="mt-1 text-ink-2">{dateLabel(f.due)} · {f.note || 'Follow-up'}</p></Link>)}{!pending.length && <p className="text-sm text-ink-muted">No pending follow-ups.</p>}</div><button className={`${button} mt-4`} onClick={() => changeTab('Calling queue')}>Open calling queue</button></section>
      <section className={card}><h2 className="text-lg font-semibold text-ink">Acquisition to purchase</h2><div className="mt-5 space-y-5">{[['Leads', stats.total], ['Contacted', stats.contacted], ['Interested now', stats.interested], ['Visited store', stats.visits], ['Converted', stats.converted]].map(([label, value]) => <div key={label}><div className="mb-2 flex justify-between text-sm text-ink"><span>{label}</span><span>{value}</span></div><div className="h-2 rounded bg-inset"><div className="h-2 rounded bg-accent" style={{ width: `${stats.total ? Number(value) / stats.total * 100 : 0}%` }} /></div></div>)}</div><p className="mt-4 text-xs text-ink-muted">Milestones can overlap; a purchase does not require a recorded call or store visit.</p></section></div>
    </>}
    {['All leads', 'Calling queue'].includes(tab) && <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="text-lg font-semibold text-ink">{tab}</h2><p className="text-xs text-ink-muted">{tab === 'Calling queue' ? 'New imported leads stay here until their first call is logged.' : 'Open a name to see the complete customer profile.'}</p></div><input className={`${input} sm:!w-80`} aria-label="Search leads" placeholder="Name, number, lead ID, campaign…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Lead / contact', 'Sources / campaign', 'Date-Time', 'Preferred store', ...(tab === 'Calling queue' ? ['Call status'] : []), ...(showLeadActions ? ['Actions'] : []), ...(tab === 'Calling queue' ? ['Log call'] : [])].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{visible.slice(currentPage * 20, currentPage * 20 + 20).map(l => <tr key={l.id} className="border-t border-line align-top"><td className="min-w-48 px-4 py-4"><Link href={`/marketing/leads/${l.id}`} className="font-semibold text-accent hover:underline">{l.name}</Link><p className="mt-1 text-ink-2">{l.phone}</p><p className="text-xs text-ink-muted">{l.email || 'Email not recorded'}</p><p className="mt-1 max-w-48 break-all text-[10px] text-ink-muted">{l.id}</p></td><td className="min-w-40 px-4 py-4 text-ink">{[...new Set(l.acquisitions.map(a => a.source))].join(', ')}<p className="mt-1 text-xs text-ink-2">{[...new Set(l.acquisitions.map(a => a.campaignId).filter(Boolean))].join(', ') || 'No campaign'}</p></td><td className="whitespace-nowrap px-4 py-4 text-ink-2">{dateLabel(l.acquiredAt)}</td><td className="px-4 py-4 text-ink-2">{l.preferredStore || 'Not recorded'}</td>{tab === 'Calling queue' && <td className="px-4 py-4 text-ink-2">Pending call</td>}{showLeadActions && <td className="min-w-72 px-4 py-4"><LeadActions lead={l} update={update} /></td>}{tab === 'Calling queue' && <td className="min-w-36 px-4 py-4"><LeadActions lead={l} update={update} variant="call-only" /></td>}</tr>)}</tbody></table></div>
      {!visible.length && <p className="p-10 text-center text-sm text-ink-muted">No leads match this view.</p>}
      <div className="flex items-center justify-between border-t border-line p-4 text-sm text-ink-2"><span>{visible.length} leads · Page {currentPage + 1} of {Math.max(1, Math.ceil(visible.length / 20))}</span><div className="flex gap-2"><button className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><button className={button} disabled={(currentPage + 1) * 20 >= visible.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
    </section>}
    {tab === 'Follow-ups' && <div className="grid items-start gap-4 lg:grid-cols-3">{['Overdue', 'Today', 'Upcoming'].map(bucket => {
      const entries = pending.filter(p => bucket === 'Overdue' ? p.followup.due < now : bucket === 'Today' ? p.followup.due >= now && p.followup.due.startsWith(today) : p.followup.due.slice(0, 10) > today);
      return <section key={bucket} className={card}><h2 className="text-lg font-semibold text-ink">{bucket} <span className="text-ink-muted">{entries.length}</span></h2><div className="mt-4 space-y-4">{entries.map(({ lead, followup: f }) => <div key={f.id} className="rounded-xl border border-line p-4"><Link href={`/marketing/leads/${lead.id}`} className="font-medium text-accent">{lead.name}</Link><p className="mt-1 text-xs text-ink-muted">{dateLabel(f.due)}</p><p className="my-3 text-sm text-ink-2">{f.note || 'Follow up with customer'}</p><LeadActions lead={lead} update={update} /><button className={`${button} mt-2`} onClick={() => update({ ...lead, followups: lead.followups.map(x => x.id === f.id ? { ...x, completedAt: nowLocal() } : x), interactions: [...lead.interactions, { id: uid(), at: nowLocal(), type: 'followup', text: `Follow-up completed: ${f.note}` }] })}>Complete</button></div>)}{!entries.length && <p className="text-sm text-ink-muted">No follow-ups.</p>}</div></section>;
    })}</div>}
    {tab === 'Team performance' && <MarketingSalespeople data={data} />}
    {tab === 'Campaigns' && <CampaignPerformance data={data} leads={scope} />}
    {tab === 'Import' && <MarketingImport data={data} save={save} refresh={refresh} />}
    <footer className="border-t border-line pt-5 text-xs text-ink-muted"><p>One lead ID per phone · Multiple acquisition sources · Shared database</p></footer>
  </main>;
}
function CampaignPerformance({ data, leads }: { data: Dataset; leads: Lead[] }) {
  const campaigns = [...new Set(leads.flatMap(lead => lead.acquisitions.map(acquisition => acquisition.campaignId.trim()).filter(Boolean)))];
  const rows = campaigns.map(campaign => {
    const campaignLeads = leads.filter(lead => lead.acquisitions.some(acquisition => acquisition.campaignId.trim() === campaign));
    const acquisitions = campaignLeads.flatMap(lead => lead.acquisitions.filter(acquisition => acquisition.campaignId.trim() === campaign));
    const sources = [...new Set(acquisitions.map(acquisition => acquisition.source))];
    const knownCosts = acquisitions.filter(acquisition => acquisition.cost !== null);
    const totalSpend = knownCosts.reduce((total, acquisition) => total + (acquisition.cost ?? 0), 0);
    return { campaign, sources, stats: metrics(data, campaignLeads), totalSpend, hasSpend: knownCosts.length > 0 };
  }).sort((a, b) => b.stats.total - a.stats.total || a.campaign.localeCompare(b.campaign));

  return <section className={card}><h2 className="text-xl font-semibold text-ink">Campaign performance</h2><p className="mt-2 text-sm text-ink-2">CPL is spend ÷ leads, CAC is spend ÷ converted customers, and ROAS is revenue ÷ spend. A dash means campaign cost data is unavailable.</p><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Campaign ID', 'Source', 'Leads', 'Contacted', 'Interested', 'Converted', 'Revenue', 'Total spend', 'CPL', 'CAC', 'ROAS'].map(heading => <th className="whitespace-nowrap p-3" key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map(({ campaign, sources, stats, totalSpend, hasSpend }) => <tr key={campaign} className="border-t border-line text-ink"><td className="min-w-64 p-3 font-medium">{campaign}</td><td className="p-3 text-ink-2">{sources.join(', ') || '—'}</td><td className="p-3">{stats.total}</td><td className="p-3">{stats.contacted}</td><td className="p-3">{stats.interested}</td><td className="p-3">{stats.converted}</td><td className="p-3">{money(stats.revenue)}</td><td className="p-3">{hasSpend ? money(totalSpend) : '—'}</td><td className="p-3">{hasSpend && stats.total ? money(totalSpend / stats.total) : '—'}</td><td className="p-3">{hasSpend && stats.converted ? money(totalSpend / stats.converted) : '—'}</td><td className="p-3">{hasSpend && totalSpend > 0 ? `${(stats.revenue / totalSpend).toFixed(2)}×` : '—'}</td></tr>)}</tbody></table>{!rows.length && <p className="p-8 text-center text-ink-muted">No campaigns match the selected filters.</p>}</div></section>;
}
function AddLead({ data, save, close }: { data: Dataset; save: (d: Dataset) => boolean; close: () => void }) {
  const [error, setError] = useState('');
  return <form className={`${card} space-y-4`} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const row = Object.fromEntries(f.entries()); row.Source = f.getAll('Source').join(';'); const preview = previewRows([row], 'leads', guessMapping(Object.keys(row)), data); if (preview.errors.length) { setError(preview.errors[0].reason); return; } if (!preview.leads.length) { setError('This phone and acquisition already exist. Open the existing profile.'); return; } if (save(commitPreview(data, preview))) close(); }}>
    <div className="flex justify-between"><h2 className="text-lg font-semibold text-ink">Capture a lead</h2><button type="button" className={button} onClick={close}>Close</button></div><p className="text-xs text-ink-muted">A new ID is generated for a new phone. Existing numbers keep their ID and gain additional acquisition sources.</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Name *"><input autoFocus required name="Name" className={input} /></Field><Field label="Contact No. *"><input required name="Number" type="tel" className={input} /></Field><Field label="Email"><input type="email" name="Email" className={input} /></Field><Field label="City"><input name="City" className={input} /></Field><Field label="Campaign ID"><input name="Campaign ID" className={input} /></Field><Field label="Date-Time (IST) *"><input required name="Date and time" type="datetime-local" defaultValue={nowLocal().slice(0, 16)} className={input} /></Field><Field label="Preferred store"><select name="Preferred Store" className={input}><option value="">Not decided</option>{STORES.map(s => <option key={s}>{s}</option>)}</select></Field><Field label="Cost per lead (optional)"><input type="number" name="Cost per lead" min="0" step="0.01" className={input} /></Field><Field label="Sources * (select one or more)"><select multiple required name="Source" className={`${input} min-h-28`}>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field></div>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<button className={primary}>Save lead to calling queue</button>
  </form>;
}
