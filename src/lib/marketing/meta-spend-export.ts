/**
 * Ad spend from a Meta Ads Manager campaign export (CSV or XLSX, one row per
 * campaign: "Campaign name", "Amount spent (INR)", "Results", "Result
 * indicator", "Reporting starts", "Reporting ends"). This is the only source
 * of spend: the lead sheets' Campaign Summary tabs are no longer read.
 *
 * Each campaign becomes one row of `marketing_campaign_spend` for the whole
 * report period (month holds the period, week is blank). Campaigns with no
 * spend are left out; a name that appears twice is added up.
 */

import * as XLSX from 'xlsx';
import { money, type CampaignSpendWeek } from './campaign-spend';

/** "01/05/2026" → "2026-05-01"; an ISO date stays as it is. */
function isoDay(value: unknown): string {
  const text = String(value ?? '').trim();
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : text.slice(0, 10);
}

export type MetaSpendExport = { rows: CampaignSpendWeek[]; from: string; to: string; total: number; skipped: number };

export function parseMetaSpendExport(file: ArrayBuffer | string): MetaSpendExport {
  const book = typeof file === 'string' ? XLSX.read(file, { type: 'string', raw: true }) : XLSX.read(file, { type: 'array', raw: true });
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]], { defval: '', raw: true });
  if (!records.length || !('Campaign name' in records[0]) || !Object.keys(records[0]).some((k) => /^amount spent/i.test(k))) {
    throw new Error('This is not a Meta Ads Manager campaign export: it needs "Campaign name" and "Amount spent (INR)" columns.');
  }
  const spentKey = Object.keys(records[0]).find((k) => /^amount spent/i.test(k))!;
  const byName = new Map<string, CampaignSpendWeek>();
  const days: string[] = [];
  let skipped = 0;
  for (const record of records) {
    const campaign = String(record['Campaign name'] ?? '').trim();
    const spend = money(record[spentKey]) ?? 0;
    if (!campaign || spend <= 0) { skipped++; continue; }
    const from = isoDay(record['Reporting starts']), to = isoDay(record['Reporting ends']);
    if (from) days.push(from);
    if (to) days.push(to);
    // Results count leads only where Meta says they are lead form submissions.
    const leads = /lead/i.test(String(record['Result indicator'] ?? '')) ? Math.round(money(record['Results']) ?? 0) : null;
    const row = byName.get(campaign) ?? { campaign, platform: 'Meta ads', month: `${from}..${to}`, week: '', spend: 0, leads: null };
    row.spend = Math.round((row.spend + spend) * 100) / 100;
    if (leads !== null) row.leads = (row.leads ?? 0) + leads;
    byName.set(campaign, row);
  }
  const rows = [...byName.values()];
  days.sort();
  return { rows, from: days[0] ?? '', to: days.at(-1) ?? '', total: Math.round(rows.reduce((a, r) => a + r.spend, 0) * 100) / 100, skipped };
}
