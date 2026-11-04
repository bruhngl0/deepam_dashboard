'use client';
import { useState } from 'react';
import { storeName, filterLeads, metrics, SOURCES, STORES, type Dataset, type Lead } from '@/lib/marketing/local';
import { campaignBuyers } from '@/lib/marketing/campaign-buyers';
import { button, card, input, primary, useMarketing } from './marketing-shared';
import { LeadTypeConversionsPanel, useLeadTypeConversions } from './lead-type-conversions-panel';
import { CampaignBreakdown } from './campaign-breakdown';

function dashboardStats(data: Dataset, leads: Lead[]) {
  const stats = metrics(data, leads);
  return {
    total: stats.total,
    converted: stats.converted,
    bills: stats.orders,
    sales: stats.revenue,
  };
}
const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;
/** Spend ÷ count, or a dash when either is missing. */
const per = (spend: number | null, count: number) => spend === null || !count ? '—' : rupees(spend / count);

export function MarketingTeamWorkspace() {
  // Every lead of any date: this dashboard covers the whole pipeline, not only the leads on salespeople's desks.
  const { data, message, refresh } = useMarketing({ allLeads: true });
  const campaignData = useLeadTypeConversions();
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [store, setStore] = useState('');
  const [source, setSource] = useState('');
  if (!data) return <p role="status" className="p-8 text-ink-2">{message || 'Loading marketing team dashboard...'}</p>;

  const availableSources = [...new Set([...SOURCES, ...data.leads.flatMap(lead => lead.acquisitions.map(acquisition => acquisition.source)).filter(Boolean)])];
  const baseLeads = filterLeads(data.leads, { from, to, store, source: '', search: '' });
  const leads = source ? baseLeads.filter(lead => lead.acquisitions.some(acquisition => acquisition.source === source)) : baseLeads;
  const stats = dashboardStats(data, leads);
  const sourceRows = availableSources.map(name => ({ name, stats: dashboardStats(data, baseLeads.filter(lead => lead.acquisitions.some(acquisition => acquisition.source === name))) }));
  // Spend comes from the Campaign Summary tabs: by campaign and week, with no store or single day.
  // It follows the Source filter; with a date range or Store filter it cannot be split, so it is not shown.
  const spendRows = campaignData.data?.spend ?? [];
  const spendFor = (name: string) => spendRows.filter(row => !name || row.platform === name).reduce((sum, row) => sum + row.spend, 0);
  const spendShown = !from && !to && !store && !!campaignData.data && !campaignData.data.spendError;
  const spend = spendShown ? spendFor(source) : null;
  const campaigns = campaignBuyers(data, leads, source, spendShown ? spendRows : null);
  const spendNote = !campaignData.data ? (campaignData.error || 'Loading spend…')
    : campaignData.data.spendError ? `Spend is unavailable: ${campaignData.data.spendError}`
    : spendShown ? `Spend is the ${source || 'Meta and Google'} total from the Campaign Summary tabs, all dates.`
    : 'Spend is recorded by campaign and week, not by store or day: clear the From, To and Store filters to see it.';
  const clear = () => { setFrom(''); setTo(''); setStore(''); setSource(''); };
  const dateLabel = from && to ? (from === to ? from : `${from} to ${to}`) : from ? `From ${from}` : to ? `Up to ${to}` : 'All dates';
  const syncFromCrm = async () => {
    setSyncing(true); setSyncNote('');
    try {
      const r = await fetch('/api/marketing/crm-conversions', { method: 'POST' });
      const body = await r.json().catch(() => ({})) as { billsAdded?: number; convertedLeads?: number; latestBill?: string | null; error?: string };
      if (!r.ok) throw new Error(body.error ?? 'Could not sync from Deepam CRM. Try again.');
      await refresh();
      setSyncNote(`Synced from Deepam CRM: ${body.convertedLeads} converted leads${body.billsAdded ? ` (${body.billsAdded} new)` : ', nothing new'}${body.latestBill ? `. CRM records up to ${body.latestBill}.` : '.'}`);
    } catch (error) { setSyncNote((error as Error).message); }
    finally { setSyncing(false); }
  };

  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-accent">Marketing team</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Lead dashboard</h1><p className="mt-2 text-sm text-ink-2">Monitor the complete pipeline or open an individual dashboard for any source.</p><div className="mt-4 flex flex-wrap items-center gap-3"><button className={primary} onClick={syncFromCrm} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync from Deepam CRM'}</button>{syncNote && <p role="status" className="text-sm text-ink-2">{syncNote}</p>}</div></header>
    {message && <p role="status" className={`${card} text-sm text-ink`}>{message}</p>}
    <section aria-label="Marketing team filters" className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end`}>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">From<input type="date" className={input} max={to || undefined} value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">To<input type="date" className={input} min={from || undefined} value={to} onChange={event => setTo(event.target.value)} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Store<select className={input} value={store} onChange={event => setStore(event.target.value)}><option value="">All stores</option>{STORES.map(value => <option key={value} value={value}>{storeName(value)}</option>)}</select></label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Source<select className={input} value={source} onChange={event => setSource(event.target.value)}><option value="">All sources</option>{availableSources.map(value => <option key={value}>{value}</option>)}</select></label>
      <button className={button} onClick={clear}>Clear filters</button>
    </section>
    <section aria-label="Source dashboards" className="space-y-3"><div className="flex items-center gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Source dashboards</h2><div className="h-px flex-1 bg-line" /></div><div className="flex gap-2 overflow-x-auto pb-2"><button className={source ? button : primary} onClick={() => setSource('')}>All sources</button>{availableSources.map(value => <button key={value} className={`${source === value ? primary : button} whitespace-nowrap`} onClick={() => setSource(value)}>{value}</button>)}</div></section>
    <section className="space-y-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Dashboard</p><h2 className="mt-1 text-2xl font-semibold text-ink">{source || 'All sources'}</h2><p className="mt-1 text-sm text-ink-2">{dateLabel} · {store || 'All stores'}</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[
      ['Total leads', stats.total], ['Converted', stats.converted], ['Conversion rate', `${stats.total ? (stats.converted / stats.total * 100).toFixed(1) : '0.0'}%`],
      ['Sales', rupees(stats.sales)], ['Bills', stats.bills], ['Spend', spend === null ? '—' : rupees(spend)], ['Cost per lead', per(spend, stats.total)], ['Cost per conversion', per(spend, stats.converted)], ['Sales per ₹1 spent', spend ? `₹${(stats.sales / spend).toFixed(2)}` : '—'],
    ].map(([label, value]) => <div className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p></div>)}</div>
    <p className="text-xs text-ink-muted">Converted, Sales and Bills: Deepam CRM bills on a lead’s phone dated on or after the lead date, every store. {spendNote}</p></section>
    {!source && <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="p-4"><h2 className="text-lg font-semibold text-ink">All source dashboards</h2><p className="text-xs text-ink-muted">Select a row to open that source’s individual dashboard.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Source', 'Total leads', 'Converted', 'Sales', 'Spend'].map(heading => <th key={heading} className="whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead><tbody>{sourceRows.map(row => <tr key={row.name} className="cursor-pointer border-t border-line text-ink hover:bg-inset" onClick={() => setSource(row.name)}><td className="px-4 py-3 font-semibold text-accent">{row.name}</td><td className="px-4 py-3">{row.stats.total}</td><td className="px-4 py-3">{row.stats.converted}</td><td className="whitespace-nowrap px-4 py-3">{rupees(row.stats.sales)}</td><td className="whitespace-nowrap px-4 py-3">{spendShown && spendFor(row.name) ? rupees(spendFor(row.name)) : '—'}</td></tr>)}</tbody></table></div></section>}
    <CampaignBreakdown campaigns={campaigns} source={source} spendShown={spendShown} filterHint="the From, To and Store filters" />
    <LeadTypeConversionsPanel data={campaignData.data} error={campaignData.error} />
  </main>;
}
