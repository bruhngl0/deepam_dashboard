'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CampaignReport } from '@/lib/marketing/campaign-report-store';
import { button, card, Field, input, money, primary } from './marketing-shared';

const pct = (n: number | null) => n === null ? '—' : `${n.toFixed(1)}%`;
const rupees = (n: number | null) => n === null ? '—' : money(n);
const count = (n: number) => n.toLocaleString('en-IN');

type Kpi = { label: string; value: string; note: string };

export function MarketingCampaign({ campaign }: { campaign: string }) {
  const router = useRouter();
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ venueStoreId: '', from: '', to: '', exhibitionExpense: '' });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  const show = (value: CampaignReport) => {
    setReport(value);
    setForm({
      venueStoreId: value.settings.venueStoreId === null ? '' : String(value.settings.venueStoreId),
      from: value.settings.from, to: value.settings.to,
      exhibitionExpense: value.settings.exhibitionExpense ? String(value.settings.exhibitionExpense) : '',
    });
  };

  useEffect(() => {
    if (!campaign) return;
    let live = true;
    fetch(`/api/marketing/campaign-report?name=${encodeURIComponent(campaign)}`)
      .then(async (r) => { const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error ?? 'Could not load this campaign.'); return body as CampaignReport; })
      .then((value) => { if (live) show(value); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [campaign]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setNote('');
    try {
      const r = await fetch('/api/marketing/campaign-report', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: campaign, settings: { ...form, venueStoreId: form.venueStoreId || null } }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? 'Could not save. Try again.');
      show(body as CampaignReport);
      setNote('Saved.');
    } catch (e) { setNote((e as Error).message); }
    finally { setSaving(false); }
  };

  const back = () => (window.history.length > 1 ? router.back() : router.push('/marketing'));
  const header = <button type="button" className="text-sm text-accent hover:underline" onClick={back}>← Back to campaigns</button>;
  if (!campaign) return <main className="mx-auto max-w-6xl space-y-4 px-4 py-8">{header}<p className="text-ink-2">Choose a campaign from the <Link className="text-accent underline" href="/marketing">Campaigns tab</Link>.</p></main>;
  if (!report) return <main className="mx-auto max-w-6xl space-y-4 px-4 py-8">{header}<p role="status" className="text-ink-2">{error || 'Loading campaign…'}</p></main>;

  const k = report.kpis;
  const venue = report.venues.find((v) => v.id === report.settings.venueStoreId);
  const event = venue && report.settings.from ? `${venue.name}, ${report.settings.from} to ${report.settings.to}` : null;
  const groups: { title: string; items: Kpi[] }[] = [
    { title: 'Leads', items: [
      { label: 'Total leads generated', value: count(k.leads), note: 'Unique contact numbers carrying this campaign, any date' },
      { label: 'Total leads converted', value: count(k.convertedLeads), note: 'Leads with a CRM bill on or after the lead date' },
      { label: 'Lead conversion percentage', value: pct(k.leadConversion), note: 'Converted ÷ leads' },
      { label: 'Total sales generated from leads', value: money(k.leadSales), note: `${count(k.leadBills)} bills from converted leads` },
    ] },
    { title: 'Footfall and sales', items: [
      { label: 'Total footfall', value: count(k.footfall), note: `${count(k.footfallPeople)} people. Walktrack visits${event ? ` at ${venue!.name} on the event dates` : ''}${event ? ' and' : ''} by this campaign’s leads` },
      { label: 'Total bills generated', value: count(k.bills), note: event ? 'Lead bills plus event bills, each once' : 'Bills from converted leads' },
      { label: 'Total sales', value: money(k.sales), note: event ? 'Lead sales plus event sales, each bill once' : 'Sales from converted leads' },
      { label: 'Average bill value', value: rupees(k.averageBill), note: 'Total sales ÷ total bills' },
      { label: 'Footfall conversion percentage', value: pct(k.footfallConversion), note: `${count(k.footfallConverted)} of ${count(k.footfall)} visits marked converted in Walktrack` },
    ] },
    { title: 'Customers', items: [
      { label: 'New customers acquired', value: count(k.newCustomers), note: 'First bill (CRM or loyalty records) on or after the campaign reached them' },
      { label: 'Existing customers', value: count(k.existingCustomers), note: 'Had bought before the campaign reached them' },
      { label: 'New customer percentage', value: pct(k.newCustomerShare), note: `New ÷ ${count(k.customers)} buying customers` },
      { label: 'Customer acquisition cost', value: rupees(k.acquisitionCost), note: 'Total investment ÷ new customers' },
    ] },
    { title: 'Cost', items: [
      { label: 'Total marketing spend', value: k.spendFound ? money(k.marketingSpend) : '—', note: report.spendError ? `Spend unavailable: ${report.spendError}` : k.spendFound ? 'Campaign Summary tab of the lead sheet' : 'No row for this campaign in the Campaign Summary tabs' },
      { label: 'Total exhibition expense', value: money(k.exhibitionExpense), note: 'Entered below' },
      { label: 'Total investment', value: money(k.investment), note: 'Marketing spend + exhibition expense' },
      { label: 'Cost per lead', value: rupees(k.costPerLead), note: 'Marketing spend ÷ leads' },
    ] },
    { title: 'Profit', items: [
      { label: 'Gross profit', value: rupees(k.grossProfit), note: `Sales less purchase value of the items sold${k.billsWithoutCost ? ` · ${count(k.billsWithoutCost)} bills without a cost left out` : ''}` },
      { label: 'Gross profit percentage', value: pct(k.grossProfitShare), note: 'Gross profit ÷ sales of those bills' },
    ] },
  ];

  return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
    <header className="space-y-2">{header}
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Campaign · {report.kind}</p>
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{report.campaign}</h1>
      <p className="text-sm text-ink-2">{report.sources.join(', ') || 'No source'} · leads {report.firstLead ?? '—'} to {report.lastLead ?? '—'}{event ? ` · event at ${event}` : ''} · CRM bills up to {report.latestBill ?? '—'}</p>
    </header>
    {groups.map((group) => <section key={group.title} className="space-y-3">
      <div className="flex items-center gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">{group.title}</h2><div className="h-px flex-1 bg-line" /></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{group.items.map((item) => <div key={item.label} className={card}>
        <p className="text-sm text-ink-2">{item.label}</p>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{item.value}</p>
        <p className="mt-2 text-xs text-ink-muted">{item.note}</p>
      </div>)}</div>
    </section>)}
    {k.billsWithoutCustomer > 0 && <p className="text-xs text-ink-muted">{count(k.billsWithoutCustomer)} bills have no customer on them and are left out of the customer counts.</p>}
    <form onSubmit={save} className={`${card} space-y-4`}>
      <div><h2 className="text-lg font-semibold text-ink">Event and exhibition expense</h2>
        <p className="mt-1 text-sm text-ink-2">For an exhibition, choose its venue and dates: footfall is the Walktrack visits there, and bills on the Exhibition till between the dates count as the event’s sales. Leave the venue empty for campaigns without an event.</p>
        {report.suggested && <p className="mt-2 text-sm text-ink">Suggested from the campaign name and the days Walktrack recorded visits at the venue. Check and save.</p>}
        {report.overlapping.length > 0 && <p role="alert" className="mt-2 text-sm text-red-600">These dates overlap {report.overlapping.join(', ')} at another venue. Both events share the Exhibition till, so bills on the shared days count in both.</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Venue"><select className={input} value={form.venueStoreId} onChange={(e) => {
          const picked = report.venues.find((v) => String(v.id) === e.target.value);
          setForm({ ...form, venueStoreId: e.target.value, from: form.from || picked?.firstVisit || '', to: form.to || picked?.lastVisit || '' });
        }}><option value="">No event</option>{report.venues.map((v) => <option key={v.id} value={v.id}>{v.name}{v.firstVisit ? ` (visits ${v.firstVisit} to ${v.lastVisit})` : ''}</option>)}</select></Field>
        <Field label="Event from"><input type="date" className={input} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
        <Field label="Event to"><input type="date" className={input} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
        <Field label="Exhibition expense (₹)"><input type="number" min="0" step="1" inputMode="decimal" className={input} value={form.exhibitionExpense} onChange={(e) => setForm({ ...form, exhibitionExpense: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-3"><button className={primary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {form.venueStoreId && <button type="button" className={button} onClick={() => setForm({ ...form, venueStoreId: '', from: '', to: '' })}>Remove event</button>}
        {note && <p role="status" className="text-sm text-ink-2">{note}</p>}</div>
    </form>
  </main>;
}
