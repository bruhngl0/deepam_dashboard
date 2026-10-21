/**
 * Ad spend from the "Campaign Summary" tab of each lead sheet.
 *
 * The tab has a heading row (Campaign name, Platform, Start date, End date,
 * then "Week N spend", "No of leads", "Cost per lead" per week), followed by
 * blocks of campaign rows. Each block is closed by a month row ("July", "Sep")
 * whose week cells name the weeks ("1-7 July") of the rows above it. Rows
 * after the last month row still count; their month is left blank.
 */

import type { Workbook } from './google-sheets';

export type CampaignSpendWeek = { campaign: string; platform: string; month: string; week: string; spend: number; leads: number | null };
export type CampaignSpend = { campaign: string; platform: string; spend: number; leads: number; weeks: number };

export const SUMMARY_TAB = /campaign\s*summary/i;
const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;

/** "₹14,565.54" or 14565.54 as a number; "-" and blanks as null. */
export function money(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').replace(/[₹,\s]/g, '');
  if (!text || text === '-') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** "Meta" / "Google" as the lead sources used everywhere else. */
export function platformSource(value: string): string {
  if (/meta|facebook|instagram/i.test(value)) return 'Meta ads';
  if (/google/i.test(value)) return 'Google ads';
  return value.trim();
}

const cell = (value: unknown) => String(value ?? '').trim();

export function parseCampaignSummary(grid: unknown[][]): CampaignSpendWeek[] {
  const header = grid.findIndex((row) => row.some((v) => /^campaign\s*name$/i.test(cell(v))));
  if (header < 0) return [];
  const heads = grid[header].map(cell);
  const nameCol = heads.findIndex((h) => /^campaign\s*name$/i.test(h));
  const platformCol = heads.findIndex((h) => /^platform$/i.test(h));
  const weekCols = heads.flatMap((h, i) => (/^week\s*\d+\s*spend$/i.test(h) ? [i] : []));

  const out: CampaignSpendWeek[] = [];
  let pending: { campaign: string; platform: string; col: number; spend: number; leads: number | null }[] = [];
  const close = (month: string, labels: string[]) => {
    for (const p of pending) out.push({ campaign: p.campaign, platform: p.platform, month, week: labels[weekCols.indexOf(p.col)] ?? '', spend: p.spend, leads: p.leads });
    pending = [];
  };
  for (const row of grid.slice(header + 1)) {
    const name = cell(row[nameCol]);
    if (!name) continue;
    if (MONTH.test(name)) { close(name, weekCols.map((c) => cell(row[c]))); continue; }
    const platform = platformSource(cell(row[platformCol]) || name.split('|')[0]);
    for (const col of weekCols) {
      const spend = money(row[col]);
      if (spend === null || spend === 0) continue;
      pending.push({ campaign: name, platform, col, spend, leads: money(row[col + 1]) });
    }
  }
  close('', []);
  return out;
}

export function campaignSpendFromWorkbooks(workbooks: Workbook[]): CampaignSpendWeek[] {
  return workbooks.flatMap((book) => book.tabs.filter((tab) => SUMMARY_TAB.test(tab.name)).flatMap((tab) => parseCampaignSummary(tab.grid)));
}

/** Campaign names compared ignoring case and spacing, so "Meta | 0001 | ..." matches however it was typed. */
export const campaignKey = (name: string) => name.toLowerCase().replace(/\s+/g, '');

export function spendByCampaign(weeks: CampaignSpendWeek[]): CampaignSpend[] {
  const map = new Map<string, CampaignSpend>();
  for (const week of weeks) {
    const key = campaignKey(week.campaign);
    const row = map.get(key) ?? { campaign: week.campaign, platform: week.platform, spend: 0, leads: 0, weeks: 0 };
    row.spend += week.spend; row.leads += week.leads ?? 0; row.weeks += 1;
    map.set(key, row);
  }
  return [...map.values()].map((row) => ({ ...row, spend: Math.round(row.spend * 100) / 100 }));
}

/**
 * Saves the weeks of spend read from the sheets (replacing what was saved before), for the analytics
 * database's cost-per-lead and payback figures. Called by the sheet sync whenever the sheets change.
 */
export async function saveCampaignSpend(weeks: CampaignSpendWeek[]): Promise<number> {
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');
  const rows = [...new Map(weeks.map((w) => [`${w.campaign}|${w.platform}|${w.month}|${w.week}`, w])).values()];
  await db.transaction(async (t) => {
    await t.execute(sql`DELETE FROM marketing_campaign_spend`);
    if (rows.length) {
      await t.execute(sql`INSERT INTO marketing_campaign_spend (campaign, platform, month, week, spend, leads)
        SELECT campaign, platform, month, week, spend, leads
        FROM json_to_recordset(${JSON.stringify(rows)}::json) AS x(campaign text, platform text, month text, week text, spend numeric, leads integer)`);
    }
  });
  return rows.length;
}
