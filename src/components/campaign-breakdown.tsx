import Link from 'next/link';
import type { CampaignBuyers } from '@/lib/marketing/campaign-buyers';
import { card } from './marketing-shared';

const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

/**
 * The campaign breakdown shared by the marketing team dashboard and Marketing
 * Intelligence's Campaigns tab: leads who bought, by campaign, then every
 * campaign's figures (lib/marketing/campaign-buyers).
 *
 * `source` set hides the Source column; `spendShown` false says which filters
 * to clear (`filterHint`); `linkReports` links each campaign to its report page.
 */
export function CampaignBreakdown({ campaigns, source, spendShown, filterHint, linkReports = false }: {
  campaigns: CampaignBuyers[]; source: string; spendShown: boolean; filterHint: string; linkReports?: boolean;
}) {
  const mostBuyers = Math.max(1, ...campaigns.map(row => row.converted));
  const name = (row: CampaignBuyers) => linkReports && row.reportName
    ? <Link href={`/marketing/campaign?name=${encodeURIComponent(row.reportName)}`} className="text-accent hover:underline">{row.campaign}</Link>
    : row.campaign;
  return <>
    <section className={card}><h2 className="text-lg font-semibold text-ink">Leads who bought, by campaign</h2><p className="mt-1 text-xs text-ink-muted">Leads from each campaign with a Deepam CRM bill on or after the day they became a lead, and the share of that campaign’s leads.</p>
      <div className="mt-4 space-y-2">{campaigns.filter(row => row.leads).map(row => <div key={row.key} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" title={`${row.converted} of ${row.leads} leads bought · ${row.bills} bills worth ${rupees(row.sales)}`}><span className="truncate text-right text-ink">{row.campaign}</span><span className="flex items-center gap-2"><span className={`h-5 rounded ${row.source === 'Google ads' ? 'bg-accent-soft' : 'bg-accent'}`} style={{ width: `${row.converted / mostBuyers * 80}%`, minWidth: row.converted ? '2px' : 0 }} /><span className="whitespace-nowrap text-xs text-ink-2">{row.converted} · {(row.rate * 100).toFixed(1)}%</span></span></div>)}{!campaigns.length && <p className="text-sm text-ink-muted">No leads match these filters.</p>}</div></section>
    <section className="overflow-hidden rounded-2xl border border-line bg-surface"><div className="p-4"><h2 className="text-lg font-semibold text-ink">Every campaign</h2><p className="text-xs text-ink-muted">One row per campaign number: a campaign’s lead form and exhibition versions are one row, and the three Varamahalakshmi campaigns are one row, each person counted once. Someone who came in through two different campaigns counts in each. Spend comes from the Campaign Summary tabs, matched by campaign number{spendShown ? '' : `; clear ${filterHint} to see it`}.{linkReports ? ' Open a campaign for its full report.' : ''}</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Campaign', ...(source ? [] : ['Source']), 'Leads', 'Bought', 'Share', 'Bills', 'Sales', 'Spent', 'Spend per customer', 'Sales per ₹1'].map(heading => <th key={heading} className={`whitespace-nowrap px-4 py-3 ${heading === 'Campaign' || heading === 'Source' ? '' : 'text-right'}`}>{heading}</th>)}</tr></thead><tbody>{campaigns.length ? campaigns.map(row => <tr key={row.key} className={`border-t border-line ${row.converted ? 'text-ink' : 'text-ink-muted'}`}><td className="px-4 py-3 font-medium">{name(row)}</td>{!source && <td className="whitespace-nowrap px-4 py-3">{row.source}</td>}<td className="px-4 py-3 text-right">{row.leads.toLocaleString('en-IN')}</td><td className="px-4 py-3 text-right font-semibold">{row.converted}</td><td className="px-4 py-3 text-right">{(row.rate * 100).toFixed(1)}%</td><td className="px-4 py-3 text-right">{row.bills}</td><td className="whitespace-nowrap px-4 py-3 text-right">{rupees(row.sales)}</td><td className="whitespace-nowrap px-4 py-3 text-right">{row.spend === null ? '—' : rupees(row.spend)}</td><td className="whitespace-nowrap px-4 py-3 text-right">{row.costPerBuyer === null ? '—' : rupees(row.costPerBuyer)}</td><td className="whitespace-nowrap px-4 py-3 text-right">{row.salesPerRupee === null ? '—' : `₹${row.salesPerRupee.toFixed(1)}`}</td></tr>) : <tr><td colSpan={source ? 9 : 10} className="px-4 py-6 text-center text-ink-muted">No leads match these filters.</td></tr>}</tbody></table></div></section>
  </>;
}
