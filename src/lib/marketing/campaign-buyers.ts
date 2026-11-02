/**
 * Leads who bought, by campaign, for the marketing team dashboard: the same
 * figures as the Meta ads report (leads, buyers, share, bills, sales, spend,
 * spend per buyer, sales per ₹1 spent).
 *
 * Campaigns are grouped by their number ("Meta | 0010 | …" → 0010), so the
 * lead form and exhibition versions of one campaign are one row, and the three
 * Varamahalakshmi campaigns are one row. A person counts once per row, from
 * their earliest lead date in it. Bought: a bill on their phone dated on or
 * after that date (`billOnOrAfterLead`, as everywhere else).
 */

import { billOnOrAfterLead, type Dataset, type Lead } from './local';
import type { CampaignSpend } from './campaign-spend';

/** Campaign numbers that show as one row. */
const MERGED = [{ source: 'Meta ads', codes: ['0006', '0007', '0008'], name: 'Varamahalakshmi (0006, 0007, 0008)' }];

export type CampaignBuyers = {
  key: string; campaign: string; source: string;
  leads: number; converted: number; rate: number; bills: number; sales: number;
  /** null when spend isn't known for this row (no Campaign Summary match, or spend hidden by a filter). */
  spend: number | null; costPerBuyer: number | null; salesPerRupee: number | null;
};

/** "Meta | 0010 | 2026 | 10 | Shubh Convention" → "0010". */
export const campaignCode = (campaign: string) => campaign.match(/^\s*[a-z]+\s*\|\s*(\d{4})\s*\|/i)?.[1] ?? null;
/** "Meta | 0010 | 2026 | 10 | Shubh Convention" → "Meta 0010 Shubh Convention". */
const shortName = (campaign: string) => campaign.replace(/^\s*([a-z]+)\s*\|\s*(\d{4})\s*\|\s*\d{4}\s*\|\s*\d{1,2}\s*\|\s*/i, '$1 $2 ').trim();

function groupOf(source: string, campaign: string) {
  const code = campaignCode(campaign);
  const merged = code ? MERGED.find((m) => m.source === source && m.codes.includes(code)) : undefined;
  if (merged) return { key: `${source}|${merged.codes.join('+')}`, codes: merged.codes, name: `${campaign.split('|')[0].trim()} ${merged.name}` };
  if (code) return { key: `${source}|${code}`, codes: [code], name: shortName(campaign) };
  return { key: `${source}|${campaign}`, codes: [] as string[], name: campaign || 'No campaign' };
}

/**
 * `source` limits the rows to that source's acquisitions (a Meta lead that also
 * came in through Google adds nothing to Google's rows on the Meta dashboard).
 * `spend` null hides spend (a Date or Store filter is on).
 */
export function campaignBuyers(data: Dataset, leads: Lead[], source: string, spend: CampaignSpend[] | null): CampaignBuyers[] {
  const bills = new Map<string, Dataset['sales']>();
  for (const sale of data.sales) bills.set(sale.phone, [...(bills.get(sale.phone) ?? []), sale]);

  const groups = new Map<string, { source: string; codes: string[]; names: string[]; first: Map<string, string> }>();
  for (const lead of leads) {
    if (!lead.date) continue;
    for (const acquisition of lead.acquisitions) {
      if (source && acquisition.source !== source) continue;
      const g = groupOf(acquisition.source, acquisition.campaignId.trim());
      const row = groups.get(g.key) ?? { source: acquisition.source, codes: g.codes, names: [] as string[], first: new Map<string, string>() };
      row.names.push(g.name);
      const seen = row.first.get(lead.phone);
      if (!seen || lead.date < seen) row.first.set(lead.phone, lead.date);
      groups.set(g.key, row);
    }
  }

  return [...groups.entries()].map(([key, row]) => {
    const invoices = new Map<string, number>();
    let converted = 0;
    for (const [phone, date] of row.first) {
      const hits = (bills.get(phone) ?? []).filter((sale) => billOnOrAfterLead(sale.date, date));
      if (hits.length) converted++;
      for (const sale of hits) invoices.set(sale.invoice, sale.amount ?? 0);
    }
    const sales = [...invoices.values()].reduce((a, b) => a + b, 0);
    const matched = spend && row.codes.length
      ? spend.filter((s) => s.platform === row.source && row.codes.includes(campaignCode(s.campaign) ?? ''))
      : [];
    const cost = matched.length ? matched.reduce((a, s) => a + s.spend, 0) : null;
    const leadCount = row.first.size;
    return {
      key, source: row.source,
      // The shortest name a row's leads carry: the campaign's own, not a "| Lead Gen" variant.
      campaign: [...new Set(row.names)].sort((a, b) => a.length - b.length)[0],
      leads: leadCount, converted, rate: leadCount ? converted / leadCount : 0, bills: invoices.size, sales,
      spend: cost, costPerBuyer: cost && converted ? cost / converted : null, salesPerRupee: cost ? sales / cost : null,
    };
  }).sort((a, b) => b.converted - a.converted || b.leads - a.leads);
}
