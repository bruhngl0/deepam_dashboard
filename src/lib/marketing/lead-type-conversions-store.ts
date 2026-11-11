/**
 * Loads every lead acquisition, CRM bill and Meta Ads Manager spend row and
 * summarizes them with `summarizeLeadTypes`.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { spendByCampaign, type CampaignSpend } from './campaign-spend';
import { summarizeLeadTypes, type LeadTypeConversions } from './lead-type-conversions';

const SPEND_TTL_MS = 60_000;
// On globalThis so route bundles share one cache, like the sheet sync's own state.
const holder = globalThis as typeof globalThis & { __campaignSpend?: { at: number; value: CampaignSpend[] } };

const rowsOf = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);

/**
 * Saved spend per campaign: Meta from the Meta Ads Manager exports (scripts/import-meta-spend.ts),
 * Google from the Google Ads API or its billing report (scripts/import-google-spend.ts). Cached for a minute.
 */
export async function campaignSpend(): Promise<CampaignSpend[]> {
  const cached = holder.__campaignSpend;
  if (cached && Date.now() - cached.at < SPEND_TTL_MS) return cached.value;
  const rows = rowsOf<{ campaign: string; platform: string; month: string; week: string; spend: number; leads: number | null }>(await db.execute(sql`
    SELECT campaign, platform, month, week, spend::float AS spend, leads FROM marketing_campaign_spend`));
  const value = spendByCampaign(rows.map((row) => ({ ...row, spend: Number(row.spend), leads: row.leads === null ? null : Number(row.leads) })));
  holder.__campaignSpend = { at: Date.now(), value };
  return value;
}

export async function leadTypeConversions(): Promise<LeadTypeConversions> {
  const [acquisitions, bills, latest, spend] = await Promise.all([
    db.execute(sql`
      SELECT ml.phone, ml.doc->>'date' AS date, coalesce(a->>'source', '') AS source,
             coalesce(a->>'campaignId', '') AS campaign_id, coalesce(ml.doc->>'claimGroup', '') AS claim_group,
             coalesce(ml.doc->'sheetTabs', '[]'::jsonb) AS sheet_tabs
      FROM marketing_leads ml, jsonb_array_elements(coalesce(ml.doc->'acquisitions', '[]'::jsonb)) a
      WHERE NULLIF(ml.doc->>'date', '') IS NOT NULL
    `),
    db.execute(sql`
      SELECT DISTINCT ml.phone, s.voucher_no AS invoice, s.bill_amount::float AS amount,
             to_char(s.billed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date
      FROM marketing_leads ml
      JOIN customers c ON c.phone_e164 = ml.phone
      JOIN sales s ON s.customer_id = c.id
      WHERE s.bill_amount > 0
    `),
    db.execute(sql`SELECT to_char(max(billed_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS latest FROM sales`),
    // A sheet that cannot be read hides the spend columns, not the conversions.
    campaignSpend().then((value) => ({ value, error: null }), (error: unknown) => {
      console.error('marketing/campaign-spend', error);
      return { value: [] as CampaignSpend[], error: error instanceof Error ? error.message : 'Could not read the saved ad spend.' };
    }),
  ]);
  const acquisitionRows = rowsOf<Record<string, unknown>>(acquisitions).map((row) => ({
    phone: String(row.phone), date: String(row.date).slice(0, 10), source: String(row.source),
    campaignId: String(row.campaign_id), claimGroup: String(row.claim_group),
    sheetTabs: Array.isArray(row.sheet_tabs) ? row.sheet_tabs.map(String) : [],
  }));
  const billRows = rowsOf<Record<string, unknown>>(bills).map((row) => ({
    phone: String(row.phone), invoice: String(row.invoice), amount: Number(row.amount), date: String(row.date),
  }));
  const latestBill = rowsOf<{ latest: string | null }>(latest)[0]?.latest ?? null;
  return { ...summarizeLeadTypes(acquisitionRows, billRows, spend.value), latestBill, spendError: spend.error, spend: spend.value };
}
