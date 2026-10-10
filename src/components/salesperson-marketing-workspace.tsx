'use client';
import { useState } from 'react';
import { callLog, campaignName, convertedLeads, filterLeads, hasLoggedCall, nowLocal, salespersonPerformance, STORES, timeAgo, type Lead } from '@/lib/marketing/local';
import { VIRTUAL_CALLS_GROUP } from '@/lib/marketing/sheet-routing';
import { button, CampaignTag, card, input, money, primary, useMarketing } from './marketing-shared';
import { LeadActions } from './marketing-lead-actions';

type SalesTab = 'My queue' | 'Follow-ups' | 'My performance';

/** Name, number and badges, then source · campaign · how long ago · store, then when the lead asked to visit (or, for Virtual calls, to be called). */
function LeadHeader({ lead }: { lead: Lead }) {
  const sources = [...new Set(lead.acquisitions.map(acquisition => acquisition.source))].join(', ');
  const campaigns = [...new Set(lead.acquisitions.map(acquisition => campaignName(acquisition.campaignId)).filter(Boolean))].join(', ');
  const visit = [lead.visitDay, lead.visitSlot].filter(Boolean).join(' · ');
  return <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-ink">{lead.name}<a href={`tel:${lead.phone}`} className="text-xs font-normal text-accent">{lead.phone}</a></h3>
      <p className="mt-0.5 text-xs text-ink-muted">{[sources, campaigns || 'No campaign', timeAgo(lead.acquiredAt), lead.preferredStore].filter(Boolean).join(' · ')}</p>
      {visit && <p className="mt-0.5 text-xs font-medium text-ink-2">{lead.claimGroup === VIRTUAL_CALLS_GROUP ? 'Call' : 'Visit'}: {visit}</p>}
    </div>
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5"><CampaignTag lead={lead} /><span className="rounded-full bg-inset px-2.5 py-1 text-[11px] font-medium text-ink-2">{lead.status}</span></div>
  </div>;
}

export function SalespersonMarketingWorkspace({ salespersonName, logoutAction }: { salespersonName: string; logoutAction: () => Promise<void> }) {
  const { data, save, message, refresh } = useMarketing();
  const [tab, setTab] = useState<SalesTab>('My queue');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [store, setStore] = useState('');
  const [page, setPage] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState('');
  if (!data) return <p role="status" className="p-8 text-ink-2">{message || 'Loading calling workspace...'}</p>;

  const convertedPhones = new Set(convertedLeads(data).map(l => l.phone));
  const claimedLeads = data.leads.filter(lead => lead.claimedBy === salespersonName);
  const queue = claimedLeads.filter(l => !hasLoggedCall(l) && !convertedPhones.has(l.phone) && !['Connected / not interested', 'Wrong number'].includes(l.status));
  const visible = filterLeads(queue, { from: date, to: date, store, source: '', search });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 20) - 1));
  const now = nowLocal().slice(0, 16);
  const today = nowLocal().slice(0, 10);
  const pending = claimedLeads.flatMap(lead => lead.followups.filter(f => !f.completedAt).map(f => ({ lead, followup: f }))).sort((a, b) => a.followup.due.localeCompare(b.followup.due));
  const currentLead = queue[0];
  const myFollowupsDue = pending.filter(({ followup }) => followup.due <= now).length;
  const callsToday = data.leads.reduce((total, lead) => total + lead.interactions.filter(interaction => interaction.type === 'call' && interaction.at.startsWith(today) && (interaction.by === salespersonName || interaction.text.endsWith(`Logged by ${salespersonName}`))).length, 0);
  const performance = salespersonPerformance(data, callLog([data]), [salespersonName])[0];
  const update = (lead: Lead) => save({ ...data, leads: data.leads.map(l => l.id === lead.id ? lead : l) });

  async function claimTenLeads() {
    setClaiming(true);
    setClaimMessage('');
    try {
      const response = await fetch('/sales/api/claims', { method: 'POST' });
      const result = await response.json() as { claimed?: number; error?: string };
      if (response.status === 409 && result.error) { setClaimMessage(result.error); return; }
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      await refresh();
      setClaimMessage(result.claimed ? `${result.claimed} leads claimed and added to your queue.` : 'No unclaimed leads are currently available.');
    } catch {
      setClaimMessage('Unable to claim leads. Please try again.');
    } finally {
      setClaiming(false);
    }
  }

  function changeTab(next: SalesTab) {
    setTab(next);
    setPage(0);
    setSearch('');
    setDate('');
    setStore('');
  }

  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Salesperson workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{salespersonName} calling desk</h1><p className="mt-2 text-sm text-ink-2">Calling queue and follow-ups only.</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-inset px-3 py-2 text-xs text-ink-2">Shared records</span><form action={logoutAction}><button className={button}>Sign out</button></form></div></header>
    {message && <p role="status" className={`${card} text-sm text-ink`}>{message}</p>}
    <section aria-label="Lead assignment" className="space-y-3"><div className="flex items-center gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Lead assignment</h2><div className="h-px flex-1 bg-line" /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className={card}><p className="text-sm text-ink-2">Total leads</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{claimedLeads.length}</p></div><div className={card}><p className="text-sm text-ink-2">Current lead</p><p className="mt-3 text-xl font-semibold tracking-tight text-ink">{currentLead?.name ?? '—'}</p><p className="mt-2 text-xs text-ink-muted">{currentLead?.phone ?? 'No active lead'}</p></div><div className={card}><p className="text-sm text-ink-2">My follow-ups due</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{myFollowupsDue}</p></div><div className={card}><p className="text-sm text-ink-2">Calls today</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{callsToday}</p></div></div><div className="flex flex-wrap items-center gap-3"><button className={primary} disabled={claiming || queue.length > 0} onClick={claimTenLeads}>{claiming ? 'Claiming leads...' : 'Claim 10 leads'}</button>{queue.length > 0 ? <p role="status" className="text-sm text-ink-2">Call the {queue.length} lead{queue.length === 1 ? '' : 's'} in your queue to claim more.</p> : claimMessage && <p role="status" className="text-sm text-ink-2">{claimMessage}</p>}</div></section>
    <section aria-label="Salesperson navigation" className="space-y-3"><div className="flex items-center gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Salesperson navigation</h2><div className="h-px flex-1 bg-line" /></div><nav className="grid grid-cols-3 gap-2" aria-label="Salesperson sections">
      {(['My queue', 'Follow-ups', 'My performance'] as const).map(value => <button key={value} className={`${tab === value ? primary : button} min-h-11 px-2 text-xs sm:text-sm`} aria-current={tab === value ? 'page' : undefined} onClick={() => changeTab(value)}>{value}{value === 'My queue' ? ` (${queue.length})` : value === 'Follow-ups' ? ` (${pending.length})` : ''}</button>)}
    </nav></section>
    {tab === 'My queue' && <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="space-y-3 p-4"><div><h2 className="text-lg font-semibold text-ink">My queue</h2><p className="text-xs text-ink-muted">Only assigned leads without a logged call appear here.</p></div><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><input className={input} type="date" aria-label="Filter by date" value={date} onChange={event => { setDate(event.target.value); setPage(0); }} /><select className={input} aria-label="Filter by store" value={store} onChange={event => { setStore(event.target.value); setPage(0); }}><option value="">All stores</option>{STORES.map(value => <option key={value}>{value}</option>)}</select><input className={input} aria-label="Search leads" placeholder="Search name or number..." value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>{(date || store || search) && <button className={button} onClick={() => { setDate(''); setStore(''); setSearch(''); setPage(0); }}>Clear filters</button>}</div>
      <div className="space-y-2 border-t border-line p-3 sm:p-4">{visible.slice(currentPage * 20, currentPage * 20 + 20).map(lead => <article key={lead.id} className="rounded-xl border border-line bg-surface px-3 py-2.5 shadow-sm"><LeadHeader lead={lead} /><div className="mt-2 flex items-center justify-between gap-4"><LeadActions lead={lead} update={update} salespersonName={salespersonName} salespersonView /><LeadActions lead={lead} update={update} variant="call-only" salespersonName={salespersonName} salespersonView /></div></article>)}
      {!visible.length && <p className="p-10 text-center text-sm text-ink-muted">No leads match this view.</p>}
      </div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4 text-sm text-ink-2"><span>{visible.length} leads · Page {currentPage + 1} of {Math.max(1, Math.ceil(visible.length / 20))}</span><div className="flex gap-2"><button className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><button className={button} disabled={(currentPage + 1) * 20 >= visible.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
    </section>}
    {tab === 'Follow-ups' && <div className="grid items-start gap-4 lg:grid-cols-3">{['Overdue', 'Today', 'Upcoming'].map(bucket => {
      const entries = pending.filter(p => bucket === 'Overdue' ? p.followup.due < now : bucket === 'Today' ? p.followup.due >= now && p.followup.due.startsWith(today) : p.followup.due.slice(0, 10) > today);
      return <section key={bucket} className={card}><h2 className="text-lg font-semibold text-ink">{bucket} <span className="text-ink-muted">{entries.length}</span></h2><div className="mt-3 space-y-2">{entries.map(({ lead, followup: f }) => <div key={f.id} className="rounded-xl border border-line px-3 py-2.5"><LeadHeader lead={lead} /><p className="mt-1.5 text-xs text-ink-2"><span className="font-medium">Due {timeAgo(f.due)}</span> · {f.note || 'Follow up with customer'}</p><div className="mt-2 flex flex-wrap items-center gap-2"><LeadActions lead={lead} update={update} salespersonName={salespersonName} salespersonView /><button className={button} onClick={() => update({ ...lead, followups: lead.followups.map(x => x.id === f.id ? { ...x, completedAt: nowLocal() } : x), interactions: [...lead.interactions, { id: crypto.randomUUID(), at: nowLocal(), type: 'followup', text: `Follow-up completed: ${f.note}` }] })}>Complete</button></div></div>)}{!entries.length && <p className="text-sm text-ink-muted">No follow-ups.</p>}</div></section>;
    })}</div>}
    {tab === 'My performance' && <section className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[['Claimed', performance.claimed], ['Called', performance.called], ['Pending', performance.pending], ['Interested', performance.interested], ['Converted', performance.converted], ['Revenue', money(performance.revenue)]].map(([label, value]) => <div className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p></div>)}</div></section>}
  </main>;
}
