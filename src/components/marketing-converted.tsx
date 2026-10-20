import Link from 'next/link';
import { storeName, campaignName, convertedLeads, type Dataset, type Lead } from '@/lib/marketing/local';
import { button, CampaignTag, card, dateLabel, input, money } from './marketing-shared';

const PAGE_SIZE = 20;

export function MarketingConverted({
  data,
  leads,
  search,
  page,
  onSearch,
  onPage,
}: {
  data: Dataset;
  leads: Lead[];
  search: string;
  page: number;
  onSearch: (value: string) => void;
  onPage: (value: number) => void;
}) {
  const converted = convertedLeads({ ...data, leads }).sort((a, b) => {
    const latestA = a.sales.reduce((latest, sale) => sale.date > latest ? sale.date : latest, '');
    const latestB = b.sales.reduce((latest, sale) => sale.date > latest ? sale.date : latest, '');
    return latestB.localeCompare(latestA) || a.name.localeCompare(b.name);
  });
  const query = search.trim().toLowerCase();
  const visible = converted.filter(lead => !query || [
    lead.id,
    lead.name,
    lead.phone,
    lead.email,
    lead.claimedBy ?? '',
    lead.status,
    ...lead.acquisitions.flatMap(acquisition => [acquisition.source, acquisition.campaignId]),
    ...lead.sales.flatMap(sale => [sale.invoice, sale.store]),
  ].join(' ').toLowerCase().includes(query));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1));
  const sales = converted.flatMap(lead => lead.sales);
  const revenue = sales.reduce((total, sale) => total + (sale.amount ?? 0), 0);
  const repeatCustomers = converted.filter(lead => lead.sales.length > 1).length;
  const sourceCounts = new Map<string, number>();
  for (const lead of converted) for (const source of new Set(lead.acquisitions.map(acquisition => acquisition.source))) {
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }
  const topSource = [...sourceCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const kpis = [
    ['Converted customers', String(converted.length), 'Unique leads with a matched purchase'],
    ['Conversion rate', `${leads.length ? (converted.length / leads.length * 100).toFixed(1) : '0.0'}%`, `${converted.length} of ${leads.length} filtered leads`],
    ['Total sales', money(revenue), 'Sales from matched purchases'],
    ['Orders', String(sales.length), 'Matched invoices'],
    ['Average bill value', sales.length ? money(revenue / sales.length) : '—', 'Sales ÷ matched invoices'],
    ['Average customer value', converted.length ? money(revenue / converted.length) : '—', 'Sales ÷ converted customers'],
    ['Repeat customers', String(repeatCustomers), 'Converted customers with 2+ orders'],
    ['Top source', topSource?.[0] ?? '—', topSource ? `${topSource[1]} converted customers` : 'No converted source in this view'],
  ];

  return <div className="space-y-5">
    <section aria-label="Converted customer KPIs" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map(([label, value, note]) => <div className={card} key={label}><p className="text-sm text-ink-2">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{value}</p><p className="mt-2 text-xs text-ink-muted">{note}</p></div>)}
    </section>
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="text-xl font-semibold text-ink">Converted customer profiles</h2><p className="mt-1 text-xs text-ink-muted">Every lead with a matched bill, with acquisition source, purchase value, and a link to the full customer profile.</p></div><input className={`${input} sm:!w-80`} aria-label="Search converted customers" placeholder="Name, number, source, invoice…" value={search} onChange={event => { onSearch(event.target.value); onPage(0); }} /></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Customer', 'Source / campaign', 'Purchase summary', 'Sales', 'Owner / status', 'Profile'].map(heading => <th className="whitespace-nowrap px-4 py-3" key={heading}>{heading}</th>)}</tr></thead><tbody>{visible.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE).map(lead => {
        const orderedSales = [...lead.sales].sort((a, b) => a.date.localeCompare(b.date));
        const customerRevenue = orderedSales.reduce((total, sale) => total + (sale.amount ?? 0), 0);
        const stores = [...new Set(orderedSales.map(sale => storeName(sale.store)).filter(Boolean))];
        const campaigns = [...new Set(lead.acquisitions.map(acquisition => campaignName(acquisition.campaignId)).filter(Boolean))];
        return <tr key={lead.id} className="border-t border-line align-top text-ink"><td className="min-w-52 px-4 py-4"><Link href={`/marketing/leads/${lead.id}`} className="font-semibold text-accent hover:underline">{lead.name}</Link><p className="mt-1 text-ink-2">{lead.phone}</p><p className="text-xs text-ink-muted">{lead.email || 'Email not recorded'}</p><p className="mt-1 text-[10px] text-ink-muted">{lead.id}</p></td><td className="min-w-56 px-4 py-4"><p>{[...new Set(lead.acquisitions.map(acquisition => acquisition.source))].join(', ')}</p><p className="mt-1 text-xs text-ink-2">{campaigns.join(', ') || 'No campaign recorded'}</p>{(lead.claimGroup || lead.tags?.length) ? <div className="mt-2 flex flex-wrap gap-1.5"><CampaignTag lead={lead} /></div> : null}</td><td className="min-w-52 px-4 py-4"><p className="font-medium">{orderedSales.length} order{orderedSales.length === 1 ? '' : 's'}</p><p className="mt-1 text-xs text-ink-2">First: {dateLabel(orderedSales[0]?.date ?? '')}</p><p className="text-xs text-ink-2">Latest: {dateLabel(orderedSales.at(-1)?.date ?? '')}</p><p className="mt-1 text-xs text-ink-muted">{stores.join(', ') || 'Store not recorded'} · {orderedSales.map(sale => sale.invoice).join(', ')}</p></td><td className="whitespace-nowrap px-4 py-4"><p className="font-semibold">{money(customerRevenue)}</p><p className="mt-1 text-xs text-ink-muted">Avg {money(customerRevenue / orderedSales.length)}</p></td><td className="min-w-40 px-4 py-4"><p>{lead.claimedBy || 'Unassigned'}</p><p className="mt-1 text-xs text-ink-2">{lead.status}</p></td><td className="px-4 py-4"><Link className={button} href={`/marketing/leads/${lead.id}`}>View profile</Link></td></tr>;
      })}</tbody></table></div>
      {!visible.length && <p className="p-10 text-center text-sm text-ink-muted">No converted customers match this view.</p>}
      <div className="flex items-center justify-between border-t border-line p-4 text-sm text-ink-2"><span>{visible.length} converted customers · Page {currentPage + 1} of {Math.max(1, Math.ceil(visible.length / PAGE_SIZE))}</span><div className="flex gap-2"><button className={button} disabled={!currentPage} onClick={() => onPage(currentPage - 1)}>Previous</button><button className={button} disabled={(currentPage + 1) * PAGE_SIZE >= visible.length} onClick={() => onPage(currentPage + 1)}>Next</button></div></div>
    </section>
  </div>;
}
