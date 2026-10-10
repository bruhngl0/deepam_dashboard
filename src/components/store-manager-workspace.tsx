'use client';
import { useState } from 'react';
import { campaignTail, convertedLeads, filterLeads, hasLoggedCall, metrics, nowLocal, type Lead } from '@/lib/marketing/local';
import { button, card, dateLabel, dayMonthYearLabel, input, money, primary, useMarketing } from './marketing-shared';
import { MarketingSalespeople } from './marketing-salespeople';

type ManagerTab = 'Overview' | 'All leads' | 'Team queue' | 'Follow-ups' | 'Team performance';
const tabs: ManagerTab[] = ['Overview', 'All leads', 'Team queue', 'Follow-ups', 'Team performance'];

function lastSalesperson(lead: Lead) {
  if (lead.claimedBy) return lead.claimedBy;
  const call = [...lead.interactions].reverse().find(interaction => interaction.type === 'call');
  return call?.by ?? call?.text.match(/ · Logged by (.+)$/)?.[1] ?? 'Unassigned';
}

export function StoreManagerWorkspace({ logoutAction }: { logoutAction: () => Promise<void> }) {
  const { data, message } = useMarketing();
  const [tab, setTab] = useState<ManagerTab>('Overview');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  if (!data) return <p role="status" className="p-8 text-ink-2">{message || 'Loading store manager workspace...'}</p>;

  const converted = convertedLeads(data);
  const convertedPhones = new Set(converted.map(lead => lead.phone));
  const queue = data.leads.filter(lead => !hasLoggedCall(lead) && !convertedPhones.has(lead.phone) && !['Connected / not interested', 'Wrong number'].includes(lead.status));
  const pending = data.leads.flatMap(lead => lead.followups.filter(followup => !followup.completedAt).map(followup => ({ lead, followup }))).sort((a, b) => a.followup.due.localeCompare(b.followup.due));
  const stats = metrics(data);
  const selected = tab === 'Team queue' ? queue : data.leads;
  const visible = filterLeads(selected, { from: '', to: '', store: '', source: '', search });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 20) - 1));
  const now = nowLocal().slice(0, 16);
  const today = nowLocal().slice(0, 10);
  const changeTab = (next: ManagerTab) => { setTab(next); setSearch(''); setPage(0); };

  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Store manager</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Team operations dashboard</h1><p className="mt-2 text-sm text-ink-2">Monitor the lead pipeline, follow-ups, and salesperson performance.</p></div><form action={logoutAction}><button className={button}>Sign out</button></form></header>
    {message && <p role="status" className={`${card} text-sm text-ink`}>{message}</p>}
    <nav className="flex flex-wrap gap-2 border-b border-line pb-3" aria-label="Store manager sections">{tabs.map(value => <button key={value} className={tab === value ? primary : button} aria-current={tab === value ? 'page' : undefined} onClick={() => changeTab(value)}>{value}{value === 'Team queue' ? ` (${queue.length})` : value === 'Follow-ups' ? ` (${pending.length})` : ''}</button>)}</nav>
    {tab === 'Overview' && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ['Total leads', stats.total], ['Team queue', queue.length], ['Pending follow-ups', pending.length], ['Interested', stats.interested], ['Converted', stats.converted], ['Revenue', money(stats.revenue)], ['Contacted', stats.contacted], ['Store visits', stats.visits],
    ].map(([label, value]) => <section className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p></section>)}</div>
      <div className="grid gap-5 lg:grid-cols-2"><section className={card}><h2 className="text-lg font-semibold text-ink">Follow-up health</h2><p className="mt-3 text-sm text-ink-2">{pending.filter(item => item.followup.due < now).length} overdue · {pending.filter(item => item.followup.due.startsWith(today)).length} due today · {pending.filter(item => item.followup.due.slice(0, 10) > today).length} upcoming</p></section><section className={card}><h2 className="text-lg font-semibold text-ink">Queue health</h2><p className="mt-3 text-sm text-ink-2">{queue.filter(lead => lastSalesperson(lead) === 'Unassigned').length} unassigned · {queue.length} active leads</p></section></div></>}
    {['All leads', 'Team queue'].includes(tab) && <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="text-lg font-semibold text-ink">{tab}</h2><p className="text-xs text-ink-muted">Team-wide lead visibility and latest salesperson activity.</p></div><input className={`${input} sm:!w-80`} aria-label="Search leads" placeholder="Name, number, campaign..." value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Lead / contact', 'Campaign', 'Date', 'Store', 'Salesperson', 'Status'].map(heading => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody>{visible.slice(currentPage * 20, currentPage * 20 + 20).map(lead => <tr key={lead.id} className="border-t border-line text-ink"><td className="px-4 py-3"><span className="font-semibold">{lead.name}</span><p className="text-ink-2">{lead.phone}</p></td><td className="px-4 py-3">{[...new Set(lead.acquisitions.map(acquisition => campaignTail(acquisition.campaignId)).filter(Boolean))].join(', ') || 'No campaign'}</td><td className="whitespace-nowrap px-4 py-3 text-ink-2">{dayMonthYearLabel(lead.acquiredAt)}</td><td className="px-4 py-3">{lead.preferredStore || 'Not recorded'}</td><td className="px-4 py-3">{lastSalesperson(lead)}</td><td className="px-4 py-3">{lead.status}</td></tr>)}</tbody></table></div>
      {!visible.length && <p className="p-10 text-center text-sm text-ink-muted">No leads match this view.</p>}<div className="flex items-center justify-between border-t border-line p-4 text-sm text-ink-2"><span>{visible.length} leads · Page {currentPage + 1} of {Math.max(1, Math.ceil(visible.length / 20))}</span><div className="flex gap-2"><button className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><button className={button} disabled={(currentPage + 1) * 20 >= visible.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></div></section>}
    {tab === 'Follow-ups' && <div className="grid items-start gap-4 lg:grid-cols-3">{['Overdue', 'Today', 'Upcoming'].map(bucket => { const entries = pending.filter(item => bucket === 'Overdue' ? item.followup.due < now : bucket === 'Today' ? item.followup.due >= now && item.followup.due.startsWith(today) : item.followup.due.slice(0, 10) > today); return <section key={bucket} className={card}><h2 className="text-lg font-semibold text-ink">{bucket} <span className="text-ink-muted">{entries.length}</span></h2><div className="mt-4 space-y-3">{entries.map(({ lead, followup }) => <div key={followup.id} className="rounded-xl border border-line p-4"><p className="font-medium text-ink">{lead.name}</p><p className="text-sm text-ink-2">{lead.phone} · {lastSalesperson(lead)}</p><p className="mt-2 text-xs text-ink-muted">{dateLabel(followup.due)}</p><p className="mt-2 text-sm text-ink-2">{followup.note || 'Follow up with customer'}</p></div>)}{!entries.length && <p className="text-sm text-ink-muted">No follow-ups.</p>}</div></section>; })}</div>}
    {tab === 'Team performance' && <MarketingSalespeople data={data} />}
  </main>;
}
