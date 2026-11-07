'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { marketingModuleFrom, marketingModuleHref, type MarketingModule } from '@/lib/marketing/modules';
import { leadIdLabel, storeName, commitPreview, convertedLeads, filterLeads, guessMapping, hasLoggedCall, isContacted, isInterested, leadSales, metrics, nowLocal, previewRows, SOURCES, STORES, uid, type Dataset, type Lead } from '@/lib/marketing/local';
import { SALESPEOPLE } from '@/lib/salespeople';
import { button, CampaignTag, card, dateLabel, Field, input, money, primary, useMarketing } from './marketing-shared';
import { MarketingSalespeople } from './marketing-salespeople';
import { MarketingImport } from './marketing-import';
import { LeadActions } from './marketing-lead-actions';
import { ExistingCustomerCallList } from './existing-customer-call-list';
import { MarketingConverted } from './marketing-converted';
import { campaignBuyers } from '@/lib/marketing/campaign-buyers';
import { useLeadTypeConversions } from './lead-type-conversions-panel';
import { CampaignBreakdown } from './campaign-breakdown';
import { control, FilterField, textButton } from './ui';
import { useUrlState } from '@/lib/use-url-state';

type Module = MarketingModule;
type LeadsView = 'Lead management' | 'Calling workspace' | 'Existing customers' | 'Online customers' | 'Import';
const LEADS_VIEWS: readonly LeadsView[] = ['Lead management', 'Calling workspace', 'Existing customers', 'Online customers', 'Import'];
type CallingView = 'Queue' | 'Follow-ups';
/** Lead statuses on Lead management. */
type Status = 'All leads' | 'New leads' | 'Follow-ups' | 'Contacted' | 'Interested' | 'Converted' | 'Closed';
const STATUSES: readonly Status[] = ['All leads', 'New leads', 'Follow-ups', 'Contacted', 'Interested', 'Converted', 'Closed'];
const CLOSED: readonly string[] = ['Connected / not interested', 'Wrong number'];
const UNASSIGNED = '__unassigned__';
const pct = (n: number, of: number) => `${of ? (n / of * 100).toFixed(1) : '0.0'}%`;

export function MarketingWorkspace() {
  const { data, save, message, refresh } = useMarketing();
  // The section comes from the URL, so the site header's tabs (nav-tabs.tsx) open it.
  const router = useRouter();
  const section = marketingModuleFrom(useSearchParams()?.get('module'));
  const setModule = (next: Module) => { if (next !== section) router.push(marketingModuleHref(next), { scroll: false }); };
  const [leadsView, setLeadsView] = useState<LeadsView>('Lead management');
  const [callingView, setCallingView] = useState<CallingView>('Queue');
  const [status, setStatus] = useUrlState<Status>('status', 'All leads');
  const [campaign, setCampaign] = useUrlState('campaign', ''); const [salesperson, setSalesperson] = useUrlState('salesperson', '');
  const [from, setFrom] = useUrlState('from', ''); const [to, setTo] = useUrlState('to', ''); const [store, setStore] = useUrlState('store', ''); const [source, setSource] = useUrlState('source', ''); const [search, setSearch] = useState('');
  const [page, setPage] = useState(0); const [add, setAdd] = useState(false);
  // A new section starts on its first page, with no search.
  const [shownModule, setShownModule] = useState(section);
  if (shownModule !== section) { setShownModule(section); setPage(0); setSearch(''); }
  if (!data) return <p role="status" className="p-8 text-ink-2">{message || 'Loading marketing workspace…'}</p>;
  const scope = filterLeads(data.leads, { from, to, store, source, search: '' });
  const matched = convertedLeads(data); const convertedPhones = new Set(matched.map(l => l.phone));
  const stats = metrics(data, scope);
  const queue = scope.filter(l => !hasLoggedCall(l) && !convertedPhones.has(l.phone) && !CLOSED.includes(l.status));
  const today = nowLocal().slice(0, 10); const now = nowLocal().slice(0, 16);
  const pending = scope.flatMap(lead => lead.followups.filter(f => !f.completedAt).map(f => ({ lead, followup: f }))).sort((a, b) => a.followup.due.localeCompare(b.followup.due));
  const overdue = pending.filter(p => p.followup.due < now);
  const dueToday = pending.filter(p => p.followup.due >= now && p.followup.due.startsWith(today));
  const update = (lead: Lead) => save({ ...data, leads: data.leads.map(l => l.id === lead.id ? lead : l) });
  const resetPage = () => setPage(0);
  function openLeads(view: LeadsView, nextStatus?: Status) { setModule('Leads'); setLeadsView(view); if (nextStatus) setStatus(nextStatus); setPage(0); setSearch(''); }

  // Lead management: the status, campaign and salesperson filters on top of the page filters.
  const hasStatus: Record<Status, (lead: Lead) => boolean> = {
    'All leads': () => true,
    'New leads': lead => !hasLoggedCall(lead) && !convertedPhones.has(lead.phone) && !CLOSED.includes(lead.status),
    'Follow-ups': lead => lead.followups.some(f => !f.completedAt),
    Contacted: isContacted,
    Interested: isInterested,
    Converted: lead => convertedPhones.has(lead.phone),
    Closed: lead => CLOSED.includes(lead.status),
  };
  const campaigns = [...new Set(scope.flatMap(l => l.acquisitions.map(a => a.campaignId.trim()).filter(Boolean)))].sort();
  const salespeople = [...new Set([...SALESPEOPLE.map(p => p.name), ...scope.map(l => l.claimedBy ?? '').filter(Boolean)])].sort();
  const managed = scope.filter(lead => (!campaign || lead.acquisitions.some(a => a.campaignId.trim() === campaign))
    && (!salesperson || (salesperson === UNASSIGNED ? !lead.claimedBy : lead.claimedBy === salesperson)));
  const statusLeads = managed.filter(hasStatus[status]);

  // Calling summary for today, from the leads on the desks.
  const contactedToday = scope.filter(l => l.interactions.some(i => i.type === 'call' && i.at.startsWith(today) && !!i.outcome?.startsWith('Connected'))).length;
  const convertedToday = new Set(leadSales(data, scope).filter(sale => sale.date.startsWith(today)).map(sale => sale.phone)).size;

  const showFilters = section !== 'Team performance' && !(section === 'Leads' && ['Existing customers', 'Online customers', 'Import'].includes(leadsView));
  const subNav = <T extends string>(label: string, items: readonly T[], current: T, choose: (item: T) => void, count?: (item: T) => number | null) =>
    <nav className="flex flex-wrap gap-2" aria-label={label}>{items.map(item => { const n = count?.(item); return <button key={item} className={current === item ? primary : button} aria-current={current === item ? 'page' : undefined} onClick={() => choose(item)}>{item}{n === null || n === undefined ? '' : ` (${n})`}</button>; })}</nav>;

  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">Marketing · Customer relationships</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Every lead. Every conversation.</h1><p className="mt-1 max-w-3xl text-sm text-ink-2">One customer profile from acquisition to follow-up and purchase.</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-inset px-3 py-2 text-xs text-ink-2">Shared records · {data.leads.length} leads</span><button className={primary} onClick={() => setAdd(!add)}>Add lead</button><button className={button} onClick={() => openLeads('Import')}>Import Excel</button></div></header>
    {message && <p role="status" className={`${card} text-sm text-ink`}>{message}</p>}
    {add && <AddLead data={data} save={save} close={() => setAdd(false)} />}
    {showFilters && <section aria-label="Marketing filters" className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-ink-muted">Filter</span>
      <FilterField label="From"><input type="date" className={control} max={to || undefined} value={from} onChange={e => { setFrom(e.target.value); resetPage(); }} /></FilterField>
      <FilterField label="To"><input type="date" className={control} min={from || undefined} value={to} onChange={e => { setTo(e.target.value); resetPage(); }} /></FilterField>
      <FilterField label="Store"><select className={control} value={store} onChange={e => { setStore(e.target.value); resetPage(); }}><option value="">All stores</option>{STORES.map(s => <option key={s} value={s}>{storeName(s)}</option>)}</select></FilterField>
      <FilterField label="Source"><select className={control} value={source} onChange={e => { setSource(e.target.value); resetPage(); }}><option value="">All sources</option>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></FilterField>
      {section === 'Leads' && leadsView === 'Lead management' && <>
        <FilterField label="Campaign"><select className={control} value={campaign} onChange={e => { setCampaign(e.target.value); resetPage(); }}><option value="">All campaigns</option>{campaigns.map(c => <option key={c}>{c}</option>)}</select></FilterField>
        <FilterField label="Status"><select className={control} value={status} onChange={e => { setStatus(e.target.value as Status); resetPage(); }}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></FilterField>
        <FilterField label="Salesperson"><select className={control} value={salesperson} onChange={e => { setSalesperson(e.target.value); resetPage(); }}><option value="">All salespeople</option><option value={UNASSIGNED}>Unassigned</option>{salespeople.map(p => <option key={p}>{p}</option>)}</select></FilterField>
      </>}
      <button className={textButton} onClick={() => { setFrom(''); setTo(''); setStore(''); setSource(''); setCampaign(''); setSalesperson(''); setStatus('All leads'); resetPage(); }}>Clear filters</button>
      <p className="w-full text-xs text-ink-muted">Filters select leads by lead date and preferred store. Sales and purchases include their full imported history. All times IST.</p>
      {from && to && from > to && <p role="alert" className="text-sm text-red-600">From must be on or before To.</p>}
    </section>}

    {section === 'Overview' && <>
      <OverviewPerformance filters={{ from, to, store, source }} />
      <section className={card}><h2 className="text-lg font-semibold text-ink">Calling and follow-up summary</h2><p className="mt-1 text-xs text-ink-muted">Today, for the leads on the calling desks. Select a figure to open it.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{([
          ['New leads awaiting first call', queue.length, () => { setCallingView('Queue'); openLeads('Calling workspace'); }],
          ['Calls due today', dueToday.length, () => { setCallingView('Follow-ups'); openLeads('Calling workspace'); }],
          ['Overdue follow-ups', overdue.length, () => { setCallingView('Follow-ups'); openLeads('Calling workspace'); }],
          ['Leads contacted today', contactedToday, null],
          ['Leads converted today', convertedToday, null],
        ] as const).map(([label, value, open]) => { const body = <><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">{label}</p><p className="tnum mt-2 text-3xl font-semibold leading-none tracking-tight text-ink">{value}</p></>; return open ? <button type="button" key={label} className="rounded-xl border border-line p-4 text-left transition hover:border-accent focus-visible:outline-2 focus-visible:outline-accent" onClick={open}>{body}</button> : <div key={label} className="rounded-xl border border-line p-4">{body}</div>; })}</div></section>
    </>}

    {section === 'Leads' && <>
      {subNav('Leads sections', LEADS_VIEWS, leadsView, view => openLeads(view))}
      {leadsView === 'Lead management' && <>
        {subNav('Lead status', STATUSES, status, s => { setStatus(s); resetPage(); }, s => managed.filter(hasStatus[s]).length)}
        {status === 'Converted'
          ? <MarketingConverted data={data} leads={statusLeads} search={search} page={page} onSearch={setSearch} onPage={setPage} />
          : <LeadTable title={status === 'All leads' ? 'All leads' : `${status}`} note="Open a name to see the complete customer profile." leads={statusLeads} search={search} page={page} onSearch={v => { setSearch(v); resetPage(); }} onPage={setPage} update={update} variant="list" />}
      </>}
      {leadsView === 'Calling workspace' && <>
        {subNav('Calling workspace', ['Queue', 'Follow-ups'] as const, callingView, view => { setCallingView(view); resetPage(); }, view => view === 'Queue' ? queue.length : pending.length)}
        {callingView === 'Queue' && <LeadTable title="Calling queue" note="New imported leads stay here until their first call is logged." leads={queue} search={search} page={page} onSearch={v => { setSearch(v); resetPage(); }} onPage={setPage} update={update} variant="queue" />}
        {callingView === 'Follow-ups' && <div className="grid items-start gap-4 lg:grid-cols-3">{['Overdue', 'Today', 'Upcoming'].map(bucket => {
          const entries = pending.filter(p => bucket === 'Overdue' ? p.followup.due < now : bucket === 'Today' ? p.followup.due >= now && p.followup.due.startsWith(today) : p.followup.due.slice(0, 10) > today);
          return <section key={bucket} className={card}><h2 className="text-lg font-semibold text-ink">{bucket} <span className="text-ink-muted">{entries.length}</span></h2><div className="mt-4 space-y-4">{entries.map(({ lead, followup: f }) => <div key={f.id} className="rounded-xl border border-line p-4"><div className="flex items-start justify-between gap-3"><Link href={`/marketing/leads/${lead.id}`} className="font-medium text-accent">{lead.name}</Link><div className="flex shrink-0 flex-wrap justify-end gap-1.5"><CampaignTag lead={lead} /></div></div><p className="mt-1 text-xs text-ink-muted">{dateLabel(f.due)}</p><p className="my-3 text-sm text-ink-2">{f.note || 'Follow up with customer'}</p><LeadActions lead={lead} update={update} /><button className={`${button} mt-2`} onClick={() => update({ ...lead, followups: lead.followups.map(x => x.id === f.id ? { ...x, completedAt: nowLocal() } : x), interactions: [...lead.interactions, { id: uid(), at: nowLocal(), type: 'followup', text: `Follow-up completed: ${f.note}` }] })}>Complete</button></div>)}{!entries.length && <p className="text-sm text-ink-muted">No follow-ups.</p>}</div></section>;
        })}</div>}
      </>}
      {leadsView === 'Existing customers' && <ExistingCustomerCallList />}
      {leadsView === 'Online customers' && <ExistingCustomerCallList key="online" list="online" />}
      {leadsView === 'Import' && <MarketingImport data={data} save={save} refresh={refresh} />}
    </>}

    {section === 'Campaigns' && <CampaignPerformance filters={{ from, to, store, source }} />}
    {section === 'Team performance' && <MarketingSalespeople data={data} />}
    <p className="text-xs text-ink-muted">Leads and bills are shared by every desk and refresh automatically. Leads can arrive from a connected Google Sheet; no live POS sync is connected. Calls, WhatsApp and email open your apps; you record outcomes here. {stats.total} leads match the page filters.</p>
    <footer className="border-t border-line pt-5 text-xs text-ink-muted"><p>One lead per Contact No. · Multiple acquisition sources · Shared database</p></footer>
  </main>;
}

/** The lead list used by Lead management (`list`) and the calling queue (`queue`, with call status and Log call). */
function LeadTable({ title, note, leads, search, page, onSearch, onPage, update, variant }: {
  title: string; note: string; leads: Lead[]; search: string; page: number; onSearch: (value: string) => void; onPage: (page: number) => void; update: (lead: Lead) => boolean; variant: 'list' | 'queue';
}) {
  const visible = filterLeads(leads, { from: '', to: '', store: '', source: '', search });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 20) - 1));
  const queue = variant === 'queue';
  return <section className="overflow-hidden rounded-2xl border border-line bg-surface">
    <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="text-lg font-semibold text-ink">{title}</h2><p className="text-xs text-ink-muted">{note}</p></div><input className={`${input} sm:!w-80`} aria-label="Search leads" placeholder="Name, number, lead ID, campaign…" value={search} onChange={e => onSearch(e.target.value)} /></div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Lead / contact', 'Sources / campaign', 'Date-Time', 'Preferred store', ...(queue ? ['Call status', 'Actions', 'Log call'] : [])].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{visible.slice(currentPage * 20, currentPage * 20 + 20).map(l => <tr key={l.id} className="border-t border-line align-top"><td className="min-w-48 px-4 py-4"><Link href={`/marketing/leads/${l.id}`} className="font-semibold text-accent hover:underline">{l.name}</Link><p className="mt-1 text-ink-2">{l.phone}</p><p className="text-xs text-ink-muted">{l.email || 'Email not recorded'}</p><p className="mt-1 max-w-48 break-all text-[10px] text-ink-muted">{leadIdLabel(l)}</p></td><td className="min-w-40 px-4 py-4 text-ink">{[...new Set(l.acquisitions.map(a => a.source))].join(', ')}<p className="mt-1 text-xs text-ink-2">{[...new Set(l.acquisitions.map(a => a.campaignId).filter(Boolean))].join(', ') || 'No campaign'}</p>{(l.claimGroup || l.tags?.length) ? <div className="mt-2 flex flex-wrap gap-1.5"><CampaignTag lead={l} /></div> : null}</td><td className="whitespace-nowrap px-4 py-4 text-ink-2">{dateLabel(l.acquiredAt)}</td><td className="px-4 py-4 text-ink-2">{storeName(l.preferredStore) || 'Not recorded'}</td>{queue && <><td className="px-4 py-4 text-ink-2">Pending call</td><td className="min-w-72 px-4 py-4"><LeadActions lead={l} update={update} /></td><td className="min-w-36 px-4 py-4"><LeadActions lead={l} update={update} variant="call-only" /></td></>}</tr>)}</tbody></table></div>
    {!visible.length && <p className="p-10 text-center text-sm text-ink-muted">No leads match this view.</p>}
    <div className="flex items-center justify-between border-t border-line p-4 text-sm text-ink-2"><span>{visible.length} leads · Page {currentPage + 1} of {Math.max(1, Math.ceil(visible.length / 20))}</span><div className="flex gap-2"><button className={button} disabled={!currentPage} onClick={() => onPage(currentPage - 1)}>Previous</button><button className={button} disabled={(currentPage + 1) * 20 >= visible.length} onClick={() => onPage(currentPage + 1)}>Next</button></div></div>
  </section>;
}

/**
 * Overview's marketing performance and lead funnel over every lead of any date (as on the
 * Campaigns tab and the marketing team dashboard), so spend and leads cover the same period.
 * Spend is recorded by campaign, not by store or day, so a date or store filter hides it.
 */
function OverviewPerformance({ filters }: { filters: { from: string; to: string; store: string; source: string } }) {
  const { data, message } = useMarketing({ allLeads: true });
  const conversions = useLeadTypeConversions();
  if (!data) return <section className={card}><h2 className="text-lg font-semibold text-ink">Marketing performance</h2><p role="status" className="mt-2 text-sm text-ink-2">{message || 'Loading every lead…'}</p></section>;
  const leads = filterLeads(data.leads, { ...filters, search: '' });
  const stats = metrics(data, leads);
  const spendShown = !filters.from && !filters.to && !filters.store && !!conversions.data && !conversions.data.spendError;
  const spend = spendShown ? conversions.data!.spend.filter(row => !filters.source || row.platform === filters.source).reduce((sum, row) => sum + row.spend, 0) : null;
  const per = (count: number) => spend === null || !count ? '—' : money(spend / count);
  const spendNote = !conversions.data ? (conversions.error || 'Loading spend…')
    : conversions.data.spendError ? `Spend is unavailable: ${conversions.data.spendError}`
    : spendShown ? `Spend: Meta from the Meta Ads Manager export, Google from the Campaign Summary tabs, all dates.`
    : 'Spend is recorded by campaign, not by store or day: clear the date and store filters to see spend, cost per lead, CAC and ROAS.';
  const funnel: [string, number][] = [['Total leads', stats.total], ['Contacted', stats.contacted], ['Interested', stats.interested], ['Converted', stats.converted]];
  return <>
    <section className={card}><h2 className="text-lg font-semibold text-ink">Marketing performance</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{[
        ['Total marketing spend', spend === null ? '—' : money(spend)], ['Total leads', stats.total.toLocaleString('en-IN')], ['Cost per lead', per(stats.total)],
        ['Converted leads', stats.converted.toLocaleString('en-IN')], ['Sales generated', money(stats.revenue)], ['CAC', per(stats.converted)], ['ROAS', spend ? `${(stats.revenue / spend).toFixed(2)}×` : '—'],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-line p-4"><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">{label}</p><p className="tnum mt-2 text-2xl font-semibold leading-none tracking-tight text-ink">{value}</p></div>)}</div>
      <p className="mt-3 text-xs text-ink-muted">Every lead of any date that matches the filters. Converted: a Deepam CRM bill on or after the lead date. CAC is spend ÷ converted leads, ROAS is sales ÷ spend. {spendNote}</p></section>
    <section className={card}><h2 className="text-lg font-semibold text-ink">Leads funnel</h2><div className="mt-5 space-y-5">{funnel.map(([label, value]) => <div key={label}><div className="mb-2 flex justify-between text-sm text-ink"><span>{label}</span><span>{value.toLocaleString('en-IN')} · {pct(value, stats.total)}</span></div><div className="h-2 rounded bg-inset"><div className="h-2 rounded bg-accent" style={{ width: `${stats.total ? value / stats.total * 100 : 0}%` }} /></div></div>)}</div>
      <p className="mt-4 text-xs text-ink-muted">Each stage as a share of total leads. Contacted: at least one connected call. Interested: latest call marked interested. Stages can overlap; a purchase does not require a recorded call.</p></section>
  </>;
}

/**
 * Campaign performance over every lead of any date, with the same figures as the
 * marketing team dashboard (lib/marketing/campaign-buyers): one row per campaign
 * number, the three Varamahalakshmi campaigns as one, spend summed from the
 * Campaign Summary tabs. It loads every lead itself; desks still show only theirs.
 */
function CampaignPerformance({ filters }: { filters: { from: string; to: string; store: string; source: string } }) {
  const { data, message } = useMarketing({ allLeads: true });
  const conversions = useLeadTypeConversions().data;
  if (!data) return <section className={card}><h2 className="text-xl font-semibold text-ink">Campaign performance</h2><p role="status" className="mt-2 text-sm text-ink-2">{message || 'Loading every lead…'}</p></section>;
  const leads = filterLeads(data.leads, { ...filters, search: '' });
  // Spend is recorded by campaign and week, not by store or day, so a date or store filter hides it.
  const spendShown = !filters.from && !filters.to && !filters.store && !!conversions && !conversions.spendError;
  const rows = campaignBuyers(data, leads, filters.source, spendShown ? conversions.spend : null);

  return <CampaignBreakdown campaigns={rows} source={filters.source} spendShown={spendShown} filterHint="the date and store filters" linkReports />;
}
function AddLead({ data, save, close }: { data: Dataset; save: (d: Dataset) => boolean; close: () => void }) {
  const [error, setError] = useState('');
  return <form className={`${card} space-y-4`} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const row = Object.fromEntries(f.entries()); row.Source = f.getAll('Source').join(';'); const preview = previewRows([row], 'leads', guessMapping(Object.keys(row)), data); if (preview.errors.length) { setError(preview.errors[0].reason); return; } if (!preview.leads.length) { setError('This phone and acquisition already exist. Open the existing profile.'); return; } if (save(commitPreview(data, preview))) close(); }}>
    <div className="flex justify-between"><h2 className="text-lg font-semibold text-ink">Capture a lead</h2><button type="button" className={button} onClick={close}>Close</button></div><p className="text-xs text-ink-muted">A new ID is generated for a new phone. Existing numbers keep their ID and gain additional acquisition sources.</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Name *"><input autoFocus required name="Name" className={input} /></Field><Field label="Contact No. *"><input required name="Number" type="tel" className={input} /></Field><Field label="Email"><input type="email" name="Email" className={input} /></Field><Field label="City"><input name="City" className={input} /></Field><Field label="Campaign ID"><input name="Campaign ID" className={input} /></Field><Field label="Date-Time (IST) *"><input required name="Date and time" type="datetime-local" defaultValue={nowLocal().slice(0, 16)} className={input} /></Field><Field label="Preferred store"><select name="Preferred Store" className={input}><option value="">Not decided</option>{STORES.map(s => <option key={s} value={s}>{storeName(s)}</option>)}</select></Field><Field label="Cost per lead (optional)"><input type="number" name="Cost per lead" min="0" step="0.01" className={input} /></Field><Field label="Sources * (select one or more)"><select multiple required name="Source" className={`${input} min-h-28`}>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field></div>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}<button className={primary}>Save lead to calling queue</button>
  </form>;
}
