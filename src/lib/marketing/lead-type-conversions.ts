/**
 * Store visit and Virtual calls leads from the lead sheets (Meta and Google),
 * how many of them converted, and what their campaigns cost.
 *
 * Unlike the campaign table, this reads every lead of any date and the CRM's
 * own bills (`sales`), not the `marketing_sales` copy. A lead counts as
 * converted when its phone has a bill dated on or after the lead date, the
 * same rule as `syncConversionsFromCrm`. Spend comes from the sheets'
 * Campaign Summary tabs (see ./campaign-spend).
 */

import { VIRTUAL_CALLS_GROUP } from './sheet-routing';
import { campaignKey, type CampaignSpend } from './campaign-spend';

export const LEAD_KINDS = ['Store visit', 'Virtual calls'] as const;
export type LeadKind = typeof LEAD_KINDS[number];
export const PLATFORMS = ['Meta ads', 'Google ads'] as const;

export type LeadAcquisitionRow = { phone: string; date: string; source: string; campaignId: string; claimGroup: string; sheetTabs: string[] };
export type LeadBillRow = { phone: string; invoice: string; amount: number; date: string };
export type LeadKindStats = { leads: number; converted: number; bills: number; sales: number; firstLead: string | null; lastLead: string | null };
/** `spend` is null when no Campaign Summary row matches; `sheetLeads` is the sheet's own "No of leads" total. */
export type Costed = { stats: LeadKindStats; spend: number | null; sheetLeads: number | null };
export const CAMPAIGN_KINDS = [...LEAD_KINDS, 'Exhibition', 'Other'] as const;
export type CampaignKind = typeof CAMPAIGN_KINDS[number];
export type CampaignRow = Costed & { campaign: string; platform: string; kind: CampaignKind };
export type LeadKindSummary = { kind: LeadKind; total: Costed; platforms: (Costed & { platform: string })[] };
export type LeadTypeConversions = { kinds: LeadKindSummary[]; campaigns: CampaignRow[]; latestBill: string | null; spendError: string | null };

/** Virtual calls wins over Store visit: those leads come in on their own tab whatever their campaign. */
export function leadKind(row: Pick<LeadAcquisitionRow, 'campaignId' | 'claimGroup' | 'sheetTabs'>): LeadKind | null {
  if (row.claimGroup === VIRTUAL_CALLS_GROUP || /virtual/i.test(row.campaignId) || row.sheetTabs.some((tab) => /virtual\s*calls/i.test(tab))) return 'Virtual calls';
  if (/store\s*visit/i.test(row.campaignId)) return 'Store visit';
  return null;
}

/** A campaign's type from its own name: Store visit, Virtual calls, an exhibition (BLVD Club, Shubh Convention, The Residency), or Other. */
export function campaignKind(campaign: string): CampaignKind {
  return leadKind({ campaignId: campaign, claimGroup: '', sheetTabs: [] })
    ?? (/exhibition|convention|blvd|residency/i.test(campaign) ? 'Exhibition' : 'Other');
}

function stats(rows: LeadAcquisitionRow[], billsByPhone: Map<string, LeadBillRow[]>): LeadKindStats {
  const leadDate = new Map<string, string>();
  for (const row of rows) if (!leadDate.has(row.phone) || row.date < leadDate.get(row.phone)!) leadDate.set(row.phone, row.date);
  const invoices = new Map<string, number>();
  let converted = 0;
  for (const [phone, date] of leadDate) {
    const hits = (billsByPhone.get(phone) ?? []).filter((bill) => bill.date >= date);
    if (hits.length) converted++;
    for (const bill of hits) invoices.set(bill.invoice, bill.amount);
  }
  const dates = [...leadDate.values()].sort();
  return {
    leads: leadDate.size, converted, bills: invoices.size,
    sales: [...invoices.values()].reduce((sum, amount) => sum + amount, 0),
    firstLead: dates[0] ?? null, lastLead: dates.at(-1) ?? null,
  };
}

function costed(rows: LeadAcquisitionRow[], spends: CampaignSpend[], billsByPhone: Map<string, LeadBillRow[]>): Costed {
  return {
    stats: stats(rows, billsByPhone),
    spend: spends.length ? Math.round(spends.reduce((sum, s) => sum + s.spend, 0) * 100) / 100 : null,
    sheetLeads: spends.length ? spends.reduce((sum, s) => sum + s.leads, 0) : null,
  };
}

export function summarizeLeadTypes(acquisitions: LeadAcquisitionRow[], bills: LeadBillRow[], spend: CampaignSpend[] = []): Omit<LeadTypeConversions, 'latestBill' | 'spendError'> {
  const billsByPhone = new Map<string, LeadBillRow[]>();
  for (const bill of bills) billsByPhone.set(bill.phone, [...(billsByPhone.get(bill.phone) ?? []), bill]);
  const typed = acquisitions.flatMap((row) => { const kind = leadKind(row); return kind ? [{ ...row, kind }] : []; });
  const spendKind = (s: CampaignSpend) => leadKind({ campaignId: s.campaign, claimGroup: '', sheetTabs: [] });

  const kinds = LEAD_KINDS.map((kind) => {
    const rows = typed.filter((row) => row.kind === kind);
    const spends = spend.filter((s) => spendKind(s) === kind);
    return {
      kind,
      total: costed(rows, spends, billsByPhone),
      platforms: PLATFORMS.map((platform) => ({ platform, ...costed(rows.filter((row) => row.source === platform), spends.filter((s) => s.platform === platform), billsByPhone) })),
    };
  });

  // One row per campaign named on a lead or in a Campaign Summary tab, typed by
  // its own name: a Storevisit campaign's lead that landed on a Virtual calls tab
  // does not make the campaign a Virtual calls one. Each row counts all of the campaign's leads.
  const names = new Map<string, { campaign: string; platform: string; kind: CampaignKind }>();
  for (const { campaignId: campaign, source: platform } of acquisitions) {
    if (campaign.trim() && !names.has(campaignKey(campaign))) names.set(campaignKey(campaign), { campaign, platform, kind: campaignKind(campaign) });
  }
  for (const s of spend) if (!names.has(campaignKey(s.campaign))) names.set(campaignKey(s.campaign), { campaign: s.campaign, platform: s.platform, kind: campaignKind(s.campaign) });
  const campaigns = [...names.entries()].map(([key, meta]) => ({
    ...meta,
    ...costed(acquisitions.filter((row) => campaignKey(row.campaignId) === key), spend.filter((s) => campaignKey(s.campaign) === key), billsByPhone),
  })).sort((a, b) => CAMPAIGN_KINDS.indexOf(a.kind) - CAMPAIGN_KINDS.indexOf(b.kind) || (b.spend ?? 0) - (a.spend ?? 0) || b.stats.leads - a.stats.leads);

  return { kinds, campaigns };
}
