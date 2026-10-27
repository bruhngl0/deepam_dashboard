/**
 * Loads every lead acquisition, CRM bill and Campaign Summary spend row and
 * summarizes them with `summarizeLeadTypes`.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaignSpendFromWorkbooks, spendByCampaign, type CampaignSpend } from './campaign-spend';
import { readWorkbook } from './google-sheets';
import { summarizeLeadTypes, type LeadTypeConversions } from './lead-type-conversions';
import { getSheetConfig } from './sheet-sync';

const SPEND_TTL_MS = 5 * 60_000;
// On globalThis so route bundles share one cache, like the sheet sync's own state.
const holder = globalThis as typeof globalThis & { __campaignSpend?: { at: number; value: CampaignSpend[] } };

const rowsOf = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);

/** Spend per campaign from the connected sheets, read at most every five minutes. */
export async function campaignSpend(): Promise<CampaignSpend[]> {
  const cached = holder.__campaignSpend;
  if (cached && Date.now() - cached.at < SPEND_TTL_MS) return cached.value;
  const config = await getSheetConfig();
  const workbooks = await Promise.all((config?.sheets ?? []).map((sheet) => readWorkbook(sheet.spreadsheetId)));
  const value = spendByCampaign(campaignSpendFromWorkbooks(workbooks));
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
      return { value: [] as CampaignSpend[], error: error instanceof Error ? error.message : 'Could not read the Campaign Summary tabs.' };
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
