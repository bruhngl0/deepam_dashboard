'use client';
import { useEffect, useState } from 'react';
import { storeName, callLog, campaignName, convertedLeads, filterLeads, hasLoggedCall, nowLocal, OUTCOMES, salespersonPerformance, STORES, timeAgo, type Dataset, type Lead } from '@/lib/marketing/local';
import { ADONMO_TAG, CHENNAI_GROUP, VIRTUAL_CALLS_GROUP } from '@/lib/marketing/sheet-routing';
import { button, CampaignTag, card, Field, input, money, primary, useMarketing } from './marketing-shared';
import { LeadActions } from './marketing-lead-actions';

type SalesTab = 'My queue' | 'Previous leads' | 'Follow-ups' | 'My performance';
type ExistingCustomerRow = { id: number; name: string; phone: string; branch: string; city: string; customerCode: string | null; claimedAt: string; preferredStore: string; product: string; category: string; followupDue: string | null; followupNote: string };
type ExistingCustomerDesk = { assignedTotal: number; remaining: number; open: number; called: number; rows: ExistingCustomerRow[]; followups: ExistingCustomerRow[] };

/** Name, number and badges, then source · campaign · how long ago · store, then when the lead asked to visit (or, for Virtual calls, to be called). */
/** Higher goes first on the desk: AdOnMo leads, then the Shubh Convention route, then the rest. */
const queuePriority = (lead: Lead) => lead.tags?.includes(ADONMO_TAG) ? 2 : lead.claimGroup === 'shubh-convention' || lead.claimGroup === CHENNAI_GROUP ? 1 : 0;

function LeadHeader({ lead }: { lead: Lead }) {
  const sources = [...new Set(lead.acquisitions.map(acquisition => acquisition.source))].join(', ');
  const campaigns = [...new Set(lead.acquisitions.map(acquisition => campaignName(acquisition.campaignId)).filter(Boolean))].join(', ');
  const visit = [lead.visitDay, lead.visitSlot].filter(Boolean).join(' · ');
  return <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-ink">{lead.name}<a href={`tel:${lead.phone}`} className="text-xs font-normal text-accent">{lead.phone}</a></h3>
      <p className="mt-0.5 text-xs text-ink-muted">{[sources, campaigns || 'No campaign', timeAgo(lead.acquiredAt), storeName(lead.preferredStore)].filter(Boolean).join(' · ')}</p>
      {visit && <p className="mt-0.5 text-xs font-medium text-ink-2">{lead.claimGroup === VIRTUAL_CALLS_GROUP ? 'Call' : 'Visit'}: {visit}</p>}
    </div>
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5"><CampaignTag lead={lead} /><span className="rounded-full bg-inset px-2.5 py-1 text-[11px] font-medium text-ink-2">{lead.status}</span></div>
  </div>;
}

export function SalespersonMarketingWorkspace({ salespersonName, logoutAction }: { salespersonName: string; logoutAction: () => Promise<void> }) {
  const { data, save, message, refresh } = useMarketing();
  const [existingDesk, setExistingDesk] = useState<ExistingCustomerDesk | null>(null);
  const [existingError, setExistingError] = useState('');
  const [tab, setTab] = useState<SalesTab>('My queue');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [store, setStore] = useState('');
  const [page, setPage] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState('');
  async function refreshExistingCustomers() {
    const response = await fetch('/sales/api/existing-customers', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setExistingDesk(await response.json() as ExistingCustomerDesk);
    setExistingError('');
  }
  useEffect(() => {
    let active = true;
    void fetch('/sales/api/existing-customers', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value = await response.json() as ExistingCustomerDesk;
        if (active) { setExistingDesk(value); setExistingError(''); }
      })
      .catch(() => { if (active) setExistingError('Unable to load your existing-customer assignment. Reload this page to try again.'); });
    return () => { active = false; };
  }, []);
  if (existingError) return <p role="alert" className="p-8 text-red-600">{existingError}</p>;
  if (!data) return <p role="status" className="p-8 text-ink-2">{message || 'Loading calling workspace...'}</p>;
  if (existingDesk && existingDesk.assignedTotal > 0) return <ExistingCustomerSalesDesk salespersonName={salespersonName} logoutAction={logoutAction} initial={existingDesk} refreshDesk={refreshExistingCustomers} data={data} save={save} />;

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
    <section aria-label="Lead assignment" className="space-y-3"><div className="flex items-center gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Lead assignment</h2><div className="h-px flex-1 bg-line" /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className={card}><p className="text-sm text-ink-2">Total leads</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{claimedLeads.length}</p></div><div className={card}><p className="text-sm text-ink-2">Current lead</p><p className="mt-3 text-xl font-semibold tracking-tight text-ink">{currentLead?.name ?? '—'}</p><p className="mt-2 text-xs text-ink-muted">{currentLead?.phone ?? 'No active lead'}</p></div><div className={card}><p className="text-sm text-ink-2">My follow-ups due</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{myFollowupsDue}</p></div><div className={card}><p className="text-sm text-ink-2">Calls today</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{callsToday}</p></div></div><div className="flex flex-wrap items-center gap-3"><button className={primary} disabled={!existingDesk || claiming || queue.length > 0} onClick={claimTenLeads}>{claiming ? 'Claiming leads...' : 'Claim 10 leads'}</button>{queue.length > 0 ? <p role="status" className="text-sm text-ink-2">Call the {queue.length} lead{queue.length === 1 ? '' : 's'} in your queue to claim more.</p> : claimMessage && <p role="status" className="text-sm text-ink-2">{claimMessage}</p>}</div></section>
    <section aria-label="Salesperson navigation" className="space-y-3"><div className="flex items-center gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Salesperson navigation</h2><div className="h-px flex-1 bg-line" /></div><nav className="grid grid-cols-3 gap-2" aria-label="Salesperson sections">
      {(['My queue', 'Follow-ups', 'My performance'] as const).map(value => <button key={value} className={`${tab === value ? primary : button} min-h-11 px-2 text-xs sm:text-sm`} aria-current={tab === value ? 'page' : undefined} onClick={() => changeTab(value)}>{value}{value === 'My queue' ? ` (${queue.length})` : value === 'Follow-ups' ? ` (${pending.length})` : ''}</button>)}
    </nav></section>
    {tab === 'My queue' && <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="space-y-3 p-4"><div><h2 className="text-lg font-semibold text-ink">My queue</h2><p className="text-xs text-ink-muted">Only assigned leads without a logged call appear here.</p></div><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><input className={input} type="date" aria-label="Filter by date" value={date} onChange={event => { setDate(event.target.value); setPage(0); }} /><select className={input} aria-label="Filter by store" value={store} onChange={event => { setStore(event.target.value); setPage(0); }}><option value="">All stores</option>{STORES.map(value => <option key={value} value={value}>{storeName(value)}</option>)}</select><input className={input} aria-label="Search leads" placeholder="Search name or number..." value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>{(date || store || search) && <button className={button} onClick={() => { setDate(''); setStore(''); setSearch(''); setPage(0); }}>Clear filters</button>}</div>
      <div className="space-y-2 border-t border-line p-3 sm:p-4">{visible.slice(currentPage * 20, currentPage * 20 + 20).map(lead => <article key={lead.id} className="rounded-xl border border-line bg-surface px-3 py-2.5 shadow-sm"><LeadHeader lead={lead} /><div className="mt-2 flex items-center justify-between gap-4"><LeadActions lead={lead} update={update} salespersonName={salespersonName} salespersonView /><LeadActions lead={lead} update={update} variant="call-only" salespersonName={salespersonName} salespersonView /></div></article>)}
      {!visible.length && <p className="p-10 text-center text-sm text-ink-muted">No leads match this view.</p>}
      </div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4 text-sm text-ink-2"><span>{visible.length} leads · Page {currentPage + 1} of {Math.max(1, Math.ceil(visible.length / 20))}</span><div className="flex gap-2"><button className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><button className={button} disabled={(currentPage + 1) * 20 >= visible.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
    </section>}
    {tab === 'Follow-ups' && <div className="grid items-start gap-4 lg:grid-cols-3">{['Overdue', 'Today', 'Upcoming'].map(bucket => {
      const entries = pending.filter(p => bucket === 'Overdue' ? p.followup.due < now : bucket === 'Today' ? p.followup.due >= now && p.followup.due.startsWith(today) : p.followup.due.slice(0, 10) > today);
      return <section key={bucket} className={card}><h2 className="text-lg font-semibold text-ink">{bucket} <span className="text-ink-muted">{entries.length}</span></h2><div className="mt-3 space-y-2">{entries.map(({ lead, followup: f }) => <div key={f.id} className="rounded-xl border border-line px-3 py-2.5"><LeadHeader lead={lead} /><p className="mt-1.5 text-xs text-ink-2"><span className="font-medium">Due {timeAgo(f.due)}</span> · {f.note || 'Follow up with customer'}</p><div className="mt-2 flex flex-wrap items-center gap-2"><LeadActions lead={lead} update={update} salespersonName={salespersonName} salespersonView /><button className={button} onClick={() => update({ ...lead, followups: lead.followups.map(x => x.id === f.id ? { ...x, completedAt: nowLocal() } : x), interactions: [...lead.interactions, { id: crypto.randomUUID(), at: nowLocal(), type: 'followup', text: `Follow-up completed: ${f.note}` }] })}>Complete</button></div></div>)}{!entries.length && <p className="text-sm text-ink-muted">No follow-ups.</p>}</div></section>;
    })}</div>}
    {tab === 'My performance' && <section className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[['Claimed', performance.claimed], ['Called', performance.called], ['Pending', performance.pending], ['Interested', performance.interested], ['Converted', performance.converted], ['Sales', money(performance.revenue)]].map(([label, value]) => <div className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p></div>)}</div></section>}
  </main>;
}

function ExistingCustomerSalesDesk({ salespersonName, logoutAction, initial, refreshDesk, data, save }: { salespersonName: string; logoutAction: () => Promise<void>; initial: ExistingCustomerDesk; refreshDesk: () => Promise<void>; data: Dataset; save: (next: Dataset) => boolean }) {
  const [desk, setDesk] = useState(initial);
  const [tab, setTab] = useState<SalesTab>('My queue');
  const [claiming, setClaiming] = useState(false);
  const [status, setStatus] = useState('');
  const previousLeads = data.leads.filter(lead => lead.claimedBy === salespersonName);
  // Campaign leads routed to them with no call yet go ahead of the existing customers: AdOnMo first, then Shubh Convention.
  const convertedPhones = new Set(convertedLeads(data).map(lead => lead.phone));
  const campaignQueue = previousLeads
    .filter(lead => !hasLoggedCall(lead) && !convertedPhones.has(lead.phone) && !['Connected / not interested', 'Wrong number'].includes(lead.status))
    .sort((a, b) => queuePriority(b) - queuePriority(a) || a.acquiredAt.localeCompare(b.acquiredAt));
  const previousFollowups = previousLeads.flatMap(lead => lead.followups.filter(followup => !followup.completedAt).map(followup => ({ lead, followup }))).sort((a, b) => a.followup.due.localeCompare(b.followup.due));
  const previousPerformance = salespersonPerformance(data, callLog([data]), [salespersonName])[0];
  const updateLead = (lead: Lead) => save({ ...data, leads: data.leads.map(value => value.id === lead.id ? lead : value) });
  async function reload() {
    await refreshDesk();
    const response = await fetch('/sales/api/existing-customers', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    setDesk(await response.json() as ExistingCustomerDesk);
  }
  async function claim() {
    setClaiming(true); setStatus('');
    try {
      const response = await fetch('/sales/api/claims', { method: 'POST' });
      const result = await response.json() as { claimed?: number; error?: string };
      if (!response.ok) { setStatus(result.error || 'Unable to claim customers.'); return; }
      await reload();
      setStatus(result.claimed ? `${result.claimed} existing customers added to your queue.` : 'Your assigned customer list is complete.');
    } catch { setStatus('Unable to claim customers. Please try again.'); }
    finally { setClaiming(false); }
  }
  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Salesperson workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{salespersonName} calling desk</h1><p className="mt-2 text-sm text-ink-2">Exhibition calls for existing customers · {desk.rows[0]?.branch || 'assigned branch'}</p></div><form action={logoutAction}><button className={button}>Sign out</button></form></header>
    <section aria-label="Existing customer assignment" className="space-y-3"><div className="flex items-center gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Existing customer assignment</h2><div className="h-px flex-1 bg-line" /></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className={card}><p className="text-sm text-ink-2">Assigned customers</p><p className="mt-3 text-3xl font-semibold text-ink">{desk.assignedTotal}</p></div><div className={card}><p className="text-sm text-ink-2">Current queue</p><p className="mt-3 text-3xl font-semibold text-ink">{desk.open}</p></div><div className={card}><p className="text-sm text-ink-2">Waiting to claim</p><p className="mt-3 text-3xl font-semibold text-ink">{desk.remaining}</p></div><div className={card}><p className="text-sm text-ink-2">Calls completed</p><p className="mt-3 text-3xl font-semibold text-ink">{desk.called}</p></div></div><div className="flex flex-wrap items-center gap-3"><button className={primary} disabled={claiming || desk.open > 0 || desk.remaining === 0} onClick={claim}>{claiming ? 'Claiming customers...' : 'Claim 10 existing customers'}</button>{desk.open > 0 && <p className="text-sm text-ink-2">Call the {desk.open} customers in your queue before claiming more.</p>}{status && <p role="status" className="text-sm text-ink-2">{status}</p>}</div></section>
    <nav className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Salesperson sections">{(['My queue', 'Previous leads', 'Follow-ups', 'My performance'] as const).map(value => <button key={value} className={`${tab === value ? primary : button} min-h-11 px-2 text-xs sm:text-sm`} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{value}{value === 'My queue' ? ` (${campaignQueue.length + desk.open})` : value === 'Previous leads' ? ` (${previousLeads.length})` : value === 'Follow-ups' ? ` (${desk.followups.length + previousFollowups.length})` : ''}</button>)}</nav>
    {tab === 'My queue' && campaignQueue.length > 0 && <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="p-4"><h2 className="text-lg font-semibold text-ink">Call these leads first <span className="text-ink-muted">{campaignQueue.length}</span></h2><p className="text-xs text-ink-muted">Campaign leads assigned to you that have not been called yet.</p></div><div className="space-y-2 border-t border-line p-3 sm:p-4">{campaignQueue.map(lead => <article key={lead.id} className="rounded-xl border border-line bg-surface px-3 py-2.5 shadow-sm"><LeadHeader lead={lead} /><div className="mt-2 flex items-center justify-between gap-4"><LeadActions lead={lead} update={updateLead} salespersonName={salespersonName} salespersonView /><LeadActions lead={lead} update={updateLead} variant="call-only" salespersonName={salespersonName} salespersonView /></div></article>)}</div></section>}
    {tab === 'My queue' && <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="p-4"><h2 className="text-lg font-semibold text-ink">My existing customer queue</h2><p className="text-xs text-ink-muted">These are existing customers, not campaign leads.</p></div><div className="space-y-3 border-t border-line p-3 sm:p-4">{desk.rows.map(customer => <ExistingCustomerCallCard key={customer.id} customer={customer} salespersonName={salespersonName} onSaved={reload} />)}{!desk.rows.length && <p className="p-8 text-center text-sm text-ink-muted">Claim your next 10 existing customers to begin calling.</p>}</div></section>}
    {tab === 'Previous leads' && <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="p-4"><h2 className="text-lg font-semibold text-ink">Previous lead records</h2><p className="text-xs text-ink-muted">Your earlier campaign, walk-in, call and outcome data remains available here.</p></div><div className="space-y-3 border-t border-line p-3 sm:p-4">{previousLeads.map(lead => { const calls = lead.interactions.filter(interaction => interaction.type === 'call'); return <article key={lead.id} className="rounded-xl border border-line p-4"><LeadHeader lead={lead} />{calls.length > 0 && <div className="mt-3 space-y-1 text-xs text-ink-2">{calls.map(call => <p key={call.id}>{call.at.replace('T', ' ').slice(0, 16)} · {call.outcome || 'Call logged'} · {call.text}</p>)}</div>}<div className="mt-3 flex flex-wrap gap-2"><LeadActions lead={lead} update={updateLead} salespersonName={salespersonName} salespersonView /><LeadActions lead={lead} update={updateLead} variant="call-only" salespersonName={salespersonName} salespersonView /></div></article>; })}{!previousLeads.length && <p className="p-8 text-center text-sm text-ink-muted">No previous lead records.</p>}</div></section>}
    {tab === 'Follow-ups' && <div className="space-y-5"><div><h2 className="text-lg font-semibold text-ink">Existing customer follow-ups</h2><div className="mt-3 grid items-start gap-4 lg:grid-cols-3">{['Overdue', 'Today', 'Upcoming'].map(bucket => { const today = nowLocal().slice(0, 10); const rows = desk.followups.filter(customer => bucket === 'Overdue' ? customer.followupDue!.slice(0, 10) < today : bucket === 'Today' ? customer.followupDue!.startsWith(today) : customer.followupDue!.slice(0, 10) > today); return <section key={bucket} className={card}><h3 className="font-semibold text-ink">{bucket} <span className="text-ink-muted">{rows.length}</span></h3><div className="mt-3 space-y-3">{rows.map(customer => <ExistingCustomerCallCard key={customer.id} customer={customer} salespersonName={salespersonName} onSaved={reload} followup />)}{!rows.length && <p className="text-sm text-ink-muted">No follow-ups.</p>}</div></section>; })}</div></div><div><h2 className="text-lg font-semibold text-ink">Previous lead follow-ups</h2><div className="mt-3 space-y-3">{previousFollowups.map(({ lead, followup }) => <article key={followup.id} className={card}><LeadHeader lead={lead} /><p className="mt-2 text-xs text-ink-2">Due {timeAgo(followup.due)} · {followup.note || 'Follow up with customer'}</p><div className="mt-3 flex flex-wrap gap-2"><LeadActions lead={lead} update={updateLead} salespersonName={salespersonName} salespersonView /><button className={button} onClick={() => updateLead({ ...lead, followups: lead.followups.map(value => value.id === followup.id ? { ...value, completedAt: nowLocal() } : value) })}>Complete</button></div></article>)}{!previousFollowups.length && <p className={`${card} text-sm text-ink-muted`}>No previous lead follow-ups.</p>}</div></div></div>}
    {tab === 'My performance' && <div className="space-y-5"><section><h2 className="mb-3 text-lg font-semibold text-ink">Existing customer calls</h2><div className="grid gap-3 sm:grid-cols-3"><div className={card}><p className="text-sm text-ink-2">Assigned</p><p className="mt-3 text-3xl font-semibold text-ink">{desk.assignedTotal}</p></div><div className={card}><p className="text-sm text-ink-2">Called</p><p className="mt-3 text-3xl font-semibold text-ink">{desk.called}</p></div><div className={card}><p className="text-sm text-ink-2">Pending</p><p className="mt-3 text-3xl font-semibold text-ink">{desk.remaining + desk.open}</p></div></div></section><section><h2 className="mb-3 text-lg font-semibold text-ink">Previous lead performance</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[['Claimed', previousPerformance.claimed], ['Called', previousPerformance.called], ['Pending', previousPerformance.pending], ['Interested', previousPerformance.interested], ['Converted', previousPerformance.converted], ['Sales', money(previousPerformance.revenue)]].map(([label, value]) => <div className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold text-ink">{value}</p></div>)}</div></section></div>}
  </main>;
}

function ExistingCustomerCallCard({ customer, salespersonName, onSaved, followup = false }: { customer: ExistingCustomerRow; salespersonName: string; onSaved: () => Promise<void>; followup?: boolean }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function completeFollowup() {
    setSaving(true); setError('');
    try { const response = await fetch(`/sales/api/existing-customers/${customer.id}/followup`, { method: 'POST' }); if (!response.ok) throw new Error('Unable to complete follow-up.'); await onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to complete follow-up.'); }
    finally { setSaving(false); }
  }
  return <article className="rounded-xl border border-line bg-surface p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-ink">{customer.name}</h3><a href={`tel:${customer.phone}`} className="mt-1 block text-sm text-accent">{customer.phone}</a><p className="mt-1 text-xs text-ink-muted">Existing customer · {customer.branch}{customer.city ? ` · ${customer.city}` : ''}</p>{customer.customerCode && <p className="mt-1 text-xs text-ink-muted">Customer ID {customer.customerCode}</p>}{followup && <p className="mt-2 text-xs font-medium text-ink-2">Due {customer.followupDue?.replace('T', ' ').slice(0, 16)} · {customer.followupNote || 'Follow up with customer'}</p>}</div><span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">Existing customer</span></div><div className="mt-3 flex flex-wrap gap-2"><a href={`tel:${customer.phone}`} className={button}>Call</a><a href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className={button}>WhatsApp</a><button className={button} onClick={() => { setOpen(true); setError(''); }}>Log call</button>{followup && <button className={button} disabled={saving} onClick={completeFollowup}>Complete</button>}</div>{error && !open && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}{open && <ExistingCustomerCallDialog customer={customer} salespersonName={salespersonName} saving={saving} error={error} close={() => setOpen(false)} submit={async body => {
    setSaving(true); setError('');
    try { const response = await fetch(`/sales/api/existing-customers/${customer.id}/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || 'Unable to save call.'); setOpen(false); await onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save call.'); }
    finally { setSaving(false); }
  }} />}</article>;
}

function ExistingCustomerCallDialog({ customer, salespersonName, saving, error, close, submit }: { customer: ExistingCustomerRow; salespersonName: string; saving: boolean; error: string; close: () => void; submit: (body: Record<string, string | null>) => Promise<void> }) {
  const [outcome, setOutcome] = useState('Connected / interested');
  const [store, setStore] = useState(customer.preferredStore || '');
  const [followupChoice, setFollowupChoice] = useState('');
  const interested = outcome === 'Connected / interested';
  return <div role="dialog" aria-modal="true" aria-label={`call for ${customer.name}`} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" onKeyDown={event => { if (event.key === 'Escape') close(); }}><form className={`${card} max-h-[90vh] w-full max-w-xl overflow-y-auto shadow-xl`} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const choice = String(form.get('followupChoice') ?? ''); let followupDue: string | null = null; if (choice) { const date = choice === 'tomorrow' ? existingAddDays(nowLocal().slice(0, 10), 1) : choice === 'three-days' ? existingAddDays(nowLocal().slice(0, 10), 3) : String(form.get('followupDate') ?? ''); followupDue = date ? `${date}T10:00` : null; } void submit({ outcome: String(form.get('outcome')), preferredStore: String(form.get('preferredStore')), product: String(form.get('product')), category: String(form.get('category')), note: String(form.get('note')), followupDue }); }}><div className="mb-4 flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-ink">Record call outcome</h2><p className="mt-1 text-sm text-ink-2">{customer.name} · {customer.phone}</p><p className="mt-1 text-xs font-medium text-accent">Existing customer</p></div><button type="button" className={button} onClick={close}>Close</button></div><div className="space-y-4"><Field label="Call outcome"><select autoFocus name="outcome" className={input} value={outcome} onChange={event => setOutcome(event.target.value)}>{OUTCOMES.map(value => <option key={value}>{value}</option>)}</select></Field><Field label={`Preferred store${interested ? ' *' : ''}`}><select name="preferredStore" className={input} required={interested} value={store} onChange={event => setStore(event.target.value)}><option value="">Not decided</option>{STORES.map(value => <option key={value} value={value}>{storeName(value)}</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Product"><input name="product" defaultValue={customer.product} className={input} required={interested && store === 'Online'} /></Field><Field label="Category"><input name="category" defaultValue={customer.category} className={input} required={interested && store === 'Online'} /></Field></div><Field label="Notes"><textarea name="note" rows={4} className={input} defaultValue={customer.followupNote} placeholder="What did the customer say? What should happen next?" /></Field><Field label="Logged by"><select name="salesperson" className={input} defaultValue={salespersonName}><option>{salespersonName}</option></select></Field><button type="button" className={followupChoice ? 'rounded-xl border border-status-good/30 bg-status-good/10 px-3 py-2 text-xs font-medium text-status-good' : button} onClick={() => setFollowupChoice(followupChoice ? '' : 'tomorrow')}>{followupChoice ? 'Remove follow-up' : 'Follow-up'}</button>{followupChoice && <div className="grid gap-3 sm:grid-cols-2"><Field label="Follow up"><select name="followupChoice" required className={input} value={followupChoice} onChange={event => setFollowupChoice(event.target.value)}><option value="tomorrow">Tomorrow</option><option value="three-days">After three days</option><option value="date">Select a date</option></select></Field>{followupChoice === 'date' && <Field label="Follow-up date"><input name="followupDate" required type="date" min={existingAddDays(nowLocal().slice(0, 10), 1)} className={input} /></Field>}</div>}</div>{error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}<button className={`${primary} mt-4`} disabled={saving}>{saving ? 'Saving...' : 'Save call outcome'}</button></form></div>;
}

function existingAddDays(date: string, days: number) { const [year, month, day] = date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10); }
