/**
 * Google ad spend from a Google Ads "Billing activity report" (Billing → Transactions → download, XLSX or CSV):
 * a title row, the period ("September 1, 2026 - November 11, 2026"), then Date, Type, Description,
 * Interactions, Costs, Credits, Running balance. Each "Campaigns" row is one campaign's cost for one day.
 *
 * Rows come out like the Google Ads API sync's (./google-ads-spend): one per campaign and day, month
 * "2026-10", week the day "2026-10-21", spend the cost before GST. Taxes, payments and adjustment
 * rows (overrun and invalid-click credits) are left out, as the API's cost leaves them out too.
 */

import * as XLSX from 'xlsx';
import { money, SPEND_PLATFORMS, type CampaignSpendWeek } from './campaign-spend';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Nov 11, 2026" or "November 11, 2026" → "2026-11-11"; anything else → "". */
export function billingDay(value: unknown): string {
  const m = String(value ?? '').trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  return m && month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}

export type GoogleBillingExport = { rows: CampaignSpendWeek[]; from: string; to: string; total: number; taxes: number };

const NOT_BILLING = 'This is not a Google Ads billing activity report: it needs "Date", "Type", "Description" and "Costs" columns.';

export function parseGoogleBillingExport(file: ArrayBuffer | string): GoogleBillingExport {
  const book = typeof file === 'string' ? XLSX.read(file, { type: 'string', raw: true }) : XLSX.read(file, { type: 'array', raw: true });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, defval: '', raw: true });
  const cell = (row: unknown[], i: number) => String(row[i] ?? '').trim();
  const at = grid.findIndex((row) => row.some((v) => String(v).trim() === 'Description') && row.some((v) => String(v).trim() === 'Costs'));
  if (at < 0) throw new Error(NOT_BILLING);
  const heads = grid[at].map((v) => String(v).trim());
  const [date, type, description, costs] = ['Date', 'Type', 'Description', 'Costs'].map((h) => heads.indexOf(h));
  if (date < 0 || type < 0) throw new Error(NOT_BILLING);

  // "September 1, 2026 - November 11, 2026" above the headings is the report period.
  const period = grid.slice(0, at).flat().map(String).find((v) => / - /.test(v) && v.split(' - ').every((d) => billingDay(d))) ?? '';
  const [from, to] = period ? period.split(' - ').map(billingDay) : ['', ''];

  const byKey = new Map<string, CampaignSpendWeek>();
  let taxes = 0;
  for (const row of grid.slice(at + 1)) {
    const kind = cell(row, type), cost = Math.abs(money(cell(row, costs).replace('−', '-')) ?? 0);
    if (/^taxes/i.test(kind)) { taxes += cost; continue; }
    if (!/^campaigns?$/i.test(kind)) continue;
    const day = billingDay(cell(row, date)), campaign = cell(row, description);
    if (!day || !campaign || !(cost > 0)) continue;
    const key = `${campaign}|${day}`;
    const saved = byKey.get(key) ?? { campaign, platform: SPEND_PLATFORMS.google, month: day.slice(0, 7), week: day, spend: 0, leads: null };
    saved.spend = Math.round((saved.spend + cost) * 100) / 100;
    byKey.set(key, saved);
  }
  const rows = [...byKey.values()].sort((a, b) => a.week.localeCompare(b.week) || a.campaign.localeCompare(b.campaign));
  const days = rows.map((r) => r.week);
  return {
    rows, from: from || days[0] || '', to: to || days.at(-1) || '',
    total: Math.round(rows.reduce((sum, r) => sum + r.spend, 0) * 100) / 100, taxes: Math.round(taxes * 100) / 100,
  };
}
