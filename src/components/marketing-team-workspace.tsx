'use client';
import { useState } from 'react';
import { filterLeads, metrics, SOURCES, STORES, type Dataset, type Lead } from '@/lib/marketing/local';
import { button, card, input, money, primary, useMarketing } from './marketing-shared';

function dashboardStats(data: Dataset, leads: Lead[]) {
  const stats = metrics(data, leads);
  return {
    total: stats.total,
    claimed: leads.filter(lead => !!lead.claimedBy).length,
    contacted: stats.contacted,
    interested: stats.interested,
    converted: stats.converted,
    revenue: stats.revenue,
  };
}

export function MarketingTeamWorkspace() {
  const { data, message } = useMarketing();
  const [date, setDate] = useState('');
  const [store, setStore] = useState('');
  const [source, setSource] = useState('');
  if (!data) return <p role="status" className="p-8 text-ink-2">{message || 'Loading marketing team dashboard...'}</p>;

  const availableSources = [...new Set([...SOURCES, ...data.leads.flatMap(lead => lead.acquisitions.map(acquisition => acquisition.source)).filter(Boolean)])];
  const baseLeads = filterLeads(data.leads, { from: date, to: date, store, source: '', search: '' });
  const leads = source ? baseLeads.filter(lead => lead.acquisitions.some(acquisition => acquisition.source === source)) : baseLeads;
  const stats = dashboardStats(data, leads);
  const sourceRows = availableSources.map(name => ({ name, stats: dashboardStats(data, baseLeads.filter(lead => lead.acquisitions.some(acquisition => acquisition.source === name))) }));
  const clear = () => { setDate(''); setStore(''); setSource(''); };

  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-accent">Marketing team</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Lead dashboard</h1><p className="mt-2 text-sm text-ink-2">Monitor the complete pipeline or open an individual dashboard for any source.</p></header>
    {message && <p role="status" className={`${card} text-sm text-ink`}>{message}</p>}
    <section aria-label="Marketing team filters" className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end`}>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Date<input type="date" className={input} value={date} onChange={event => setDate(event.target.value)} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Store<select className={input} value={store} onChange={event => setStore(event.target.value)}><option value="">All stores</option>{STORES.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Source<select className={input} value={source} onChange={event => setSource(event.target.value)}><option value="">All sources</option>{availableSources.map(value => <option key={value}>{value}</option>)}</select></label>
      <button className={button} onClick={clear}>Clear filters</button>
    </section>
    <section aria-label="Source dashboards" className="space-y-3"><div className="flex items-center gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Source dashboards</h2><div className="h-px flex-1 bg-line" /></div><div className="flex gap-2 overflow-x-auto pb-2"><button className={source ? button : primary} onClick={() => setSource('')}>All sources</button>{availableSources.map(value => <button key={value} className={`${source === value ? primary : button} whitespace-nowrap`} onClick={() => setSource(value)}>{value}</button>)}</div></section>
    <section className="space-y-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Dashboard</p><h2 className="mt-1 text-2xl font-semibold text-ink">{source || 'All sources'}</h2><p className="mt-1 text-sm text-ink-2">{date || 'All dates'} · {store || 'All stores'}</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{[
      ['Total leads', stats.total], ['Claimed leads', stats.claimed], ['Contacted', stats.contacted], ['Interested', stats.interested], ['Converted', stats.converted], ['Lead revenue', money(stats.revenue)],
    ].map(([label, value]) => <div className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p></div>)}</div></section>
    {!source && <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="p-4"><h2 className="text-lg font-semibold text-ink">All source dashboards</h2><p className="text-xs text-ink-muted">Select a row to open that source’s individual dashboard.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Source', 'Total leads', 'Claimed leads', 'Contacted', 'Interested', 'Converted', 'Lead revenue'].map(heading => <th key={heading} className="whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead><tbody>{sourceRows.map(row => <tr key={row.name} className="cursor-pointer border-t border-line text-ink hover:bg-inset" onClick={() => setSource(row.name)}><td className="px-4 py-3 font-semibold text-accent">{row.name}</td><td className="px-4 py-3">{row.stats.total}</td><td className="px-4 py-3">{row.stats.claimed}</td><td className="px-4 py-3">{row.stats.contacted}</td><td className="px-4 py-3">{row.stats.interested}</td><td className="px-4 py-3">{row.stats.converted}</td><td className="px-4 py-3">{money(row.stats.revenue)}</td></tr>)}</tbody></table></div></section>}
  </main>;
}
