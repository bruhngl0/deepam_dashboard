'use client';
import { useState } from 'react';
import { storeName, filterLeads, metrics, SOURCES, STORES, type Dataset, type Lead } from '@/lib/marketing/local';
import { campaignBuyers } from '@/lib/marketing/campaign-buyers';
import { button, card, input, primary, useMarketing } from './marketing-shared';
import { LeadTypeConversionsPanel, useLeadTypeConversions } from './lead-type-conversions-panel';

function dashboardStats(data: Dataset, leads: Lead[]) {
  const stats = metrics(data, leads);
  return {
    total: stats.total,
    claimed: leads.filter(lead => !!lead.claimedBy).length,
    contacted: stats.contacted,
    interested: stats.interested,
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
  const [date, setDate] = useState('');
  const [store, setStore] = useState('');
  const [source, setSource] = useState('');
  if (!data) return <p role="status" className="p-8 text-ink-2">{message || 'Loading marketing team dashboard...'}</p>;

  const availableSources = [...new Set([...SOURCES, ...data.leads.flatMap(lead => lead.acquisitions.map(acquisition => acquisition.source)).filter(Boolean)])];
  const baseLeads = filterLeads(data.leads, { from: date, to: date, store, source: '', search: '' });
  const leads = source ? baseLeads.filter(lead => lead.acquisitions.some(acquisition => acquisition.source === source)) : baseLeads;
  const stats = dashboardStats(data, leads);
  const sourceRows = availableSources.map(name => ({ name, stats: dashboardStats(data, baseLeads.filter(lead => lead.acquisitions.some(acquisition => acquisition.source === name))) }));
  // Spend comes from the Campaign Summary tabs: by campaign and week, with no store or single day.
  // It follows the Source filter; with a Date or Store filter it cannot be split, so it is not shown.
  const spendRows = campaignData.data?.spend ?? [];
  const spendFor = (name: string) => spendRows.filter(row => !name || row.platform === name).reduce((sum, row) => sum + row.spend, 0);
  const spendShown = !date && !store && !!campaignData.data && !campaignData.data.spendError;
  const spend = spendShown ? spendFor(source) : null;
  const campaigns = campaignBuyers(data, leads, source, spendShown ? spendRows : null);
  const mostBuyers = Math.max(1, ...campaigns.map(row => row.converted));
  const spendNote = !campaignData.data ? (campaignData.error || 'Loading spend…')
    : campaignData.data.spendError ? `Spend is unavailable: ${campaignData.data.spendError}`
    : spendShown ? `Spend is the ${source || 'Meta and Google'} total from the Campaign Summary tabs, all dates.`
    : 'Spend is recorded by campaign and week, not by store or day: clear the Date and Store filters to see it.';
  const clear = () => { setDate(''); setStore(''); setSource(''); };
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
    <section aria-label="Marketing team filters" className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end`}>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Date<input type="date" className={input} value={date} onChange={event => setDate(event.target.value)} /></label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Store<select className={input} value={store} onChange={event => setStore(event.target.value)}><option value="">All stores</option>{STORES.map(value => <option key={value} value={value}>{storeName(value)}</option>)}</select></label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">Source<select className={input} value={source} onChange={event => setSource(event.target.value)}><option value="">All sources</option>{availableSources.map(value => <option key={value}>{value}</option>)}</select></label>
      <button className={button} onClick={clear}>Clear filters</button>
    </section>
    <section aria-label="Source dashboards" className="space-y-3"><div className="flex items-center gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Source dashboards</h2><div className="h-px flex-1 bg-line" /></div><div className="flex gap-2 overflow-x-auto pb-2"><button className={source ? button : primary} onClick={() => setSource('')}>All sources</button>{availableSources.map(value => <button key={value} className={`${source === value ? primary : button} whitespace-nowrap`} onClick={() => setSource(value)}>{value}</button>)}</div></section>
    <section className="space-y-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-accent">Dashboard</p><h2 className="mt-1 text-2xl font-semibold text-ink">{source || 'All sources'}</h2><p className="mt-1 text-sm text-ink-2">{date || 'All dates'} · {store || 'All stores'}</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{[
      ['Total leads', stats.total], ['Claimed leads', stats.claimed], ['Contacted', stats.contacted], ['Interested', stats.interested], ['Converted', stats.converted], ['Conversion rate', `${stats.total ? (stats.converted / stats.total * 100).toFixed(1) : '0.0'}%`],
      ['Sales', rupees(stats.sales)], ['Bills', stats.bills], ['Spend', spend === null ? '—' : rupees(spend)], ['Cost per lead', per(spend, stats.total)], ['Cost per conversion', per(spend, stats.converted)], ['Sales per ₹1 spent', spend ? `₹${(stats.sales / spend).toFixed(2)}` : '—'],
    ].map(([label, value]) => <div className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p></div>)}</div>
    <p className="text-xs text-ink-muted">Converted, Sales and Bills: Deepam CRM bills on a lead’s phone dated on or after the lead date, every store. {spendNote}</p></section>
    {!source && <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="p-4"><h2 className="text-lg font-semibold text-ink">All source dashboards</h2><p className="text-xs text-ink-muted">Select a row to open that source’s individual dashboard.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Source', 'Total leads', 'Claimed leads', 'Contacted', 'Interested', 'Converted', 'Sales', 'Spend'].map(heading => <th key={heading} className="whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead><tbody>{sourceRows.map(row => <tr key={row.name} className="cursor-pointer border-t border-line text-ink hover:bg-inset" onClick={() => setSource(row.name)}><td className="px-4 py-3 font-semibold text-accent">{row.name}</td><td className="px-4 py-3">{row.stats.total}</td><td className="px-4 py-3">{row.stats.claimed}</td><td className="px-4 py-3">{row.stats.contacted}</td><td className="px-4 py-3">{row.stats.interested}</td><td className="px-4 py-3">{row.stats.converted}</td><td className="whitespace-nowrap px-4 py-3">{rupees(row.stats.sales)}</td><td className="whitespace-nowrap px-4 py-3">{spendShown && spendFor(row.name) ? rupees(spendFor(row.name)) : '—'}</td></tr>)}</tbody></table></div></section>}
    <section className={card}><h2 className="text-lg font-semibold text-ink">Leads who bought, by campaign</h2><p className="mt-1 text-xs text-ink-muted">Leads from each campaign with a Deepam CRM bill on or after the day they became a lead, and the share of that campaign’s leads.</p>
      <div className="mt-4 space-y-2">{campaigns.filter(row => row.leads).map(row => <div key={row.key} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" title={`${row.converted} of ${row.leads} leads bought · ${row.bills} bills worth ${rupees(row.sales)}`}><span className="truncate text-right text-ink">{row.campaign}</span><span className="flex items-center gap-2"><span className={`h-5 rounded ${row.source === 'Google ads' ? 'bg-accent-soft' : 'bg-accent'}`} style={{ width: `${row.converted / mostBuyers * 80}%`, minWidth: row.converted ? '2px' : 0 }} /><span className="whitespace-nowrap text-xs text-ink-2">{row.converted} · {(row.rate * 100).toFixed(1)}%</span></span></div>)}{!campaigns.length && <p className="text-sm text-ink-muted">No leads match these filters.</p>}</div></section>
    <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="p-4"><h2 className="text-lg font-semibold text-ink">Every campaign</h2><p className="text-xs text-ink-muted">One row per campaign number: a campaign’s lead form and exhibition versions are one row, and the three Varamahalakshmi campaigns are one row, each person counted once. Someone who came in through two different campaigns counts in each. Spend comes from the Campaign Summary tabs, matched by campaign number{spendShown ? '' : '; clear the Date and Store filters to see it'}.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Campaign', ...(source ? [] : ['Source']), 'Leads', 'Bought', 'Share', 'Bills', 'Sales', 'Spent', 'Spend per buyer', 'Sales per ₹1'].map(heading => <th key={heading} className={`whitespace-nowrap px-4 py-3 ${heading === 'Campaign' || heading === 'Source' ? '' : 'text-right'}`}>{heading}</th>)}</tr></thead><tbody>{campaigns.length ? campaigns.map(row => <tr key={row.key} className={`border-t border-line ${row.converted ? 'text-ink' : 'text-ink-muted'}`}><td className="px-4 py-3 font-medium">{row.campaign}</td>{!source && <td className="whitespace-nowrap px-4 py-3">{row.source}</td>}<td className="px-4 py-3 text-right">{row.leads.toLocaleString('en-IN')}</td><td className="px-4 py-3 text-right font-semibold">{row.converted}</td><td className="px-4 py-3 text-right">{(row.rate * 100).toFixed(1)}%</td><td className="px-4 py-3 text-right">{row.bills}</td><td className="whitespace-nowrap px-4 py-3 text-right">{rupees(row.sales)}</td><td className="whitespace-nowrap px-4 py-3 text-right">{row.spend === null ? '—' : rupees(row.spend)}</td><td className="whitespace-nowrap px-4 py-3 text-right">{row.costPerBuyer === null ? '—' : rupees(row.costPerBuyer)}</td><td className="whitespace-nowrap px-4 py-3 text-right">{row.salesPerRupee === null ? '—' : `₹${row.salesPerRupee.toFixed(1)}`}</td></tr>) : <tr><td colSpan={source ? 9 : 10} className="px-4 py-6 text-center text-ink-muted">No leads match these filters.</td></tr>}</tbody></table></div></section>
    <LeadTypeConversionsPanel data={campaignData.data} error={campaignData.error} />
  </main>;
}
