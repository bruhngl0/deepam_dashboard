/**
 * Pulls conversions from the CRM into Marketing Intelligence.
 *
 * A lead counts as converted once its phone has a CRM bill (`sales`, the POS
 * imports and the Hemparshwa sync) dated on or after the lead's date. Those bills
 * are copied into `marketing_sales`, which every Marketing Intelligence view
 * already reads for conversions. Idempotent: a bill is keyed on its voucher number.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { VIRTUAL_CALLS_GROUP } from './sheet-routing';
import { LEADS_FROM } from './store';

export type CrmConversionSync = { billsAdded: number; convertedLeads: number; latestBill: string | null };

const rowsOf = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);

export async function syncConversionsFromCrm(): Promise<CrmConversionSync> {
  const added = rowsOf<{ invoice: string }>(await db.execute(sql`
    INSERT INTO marketing_sales (invoice, phone, amount, sold_at, store)
    SELECT DISTINCT ON (s.voucher_no)
      s.voucher_no,
      ml.phone,
      s.bill_amount,
      to_char(s.billed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
      CASE st.code WHEN 'MG_ROAD' THEN 'MG' WHEN 'JAYANAGAR' THEN 'JAYNAGAR' WHEN 'ONLINE' THEN 'Online' ELSE '' END
    FROM marketing_leads ml
    JOIN customers c ON c.phone_e164 = ml.phone
    JOIN sales s ON s.customer_id = c.id
    JOIN stores st ON st.id = s.store_id
    WHERE s.bill_amount > 0
      AND NULLIF(ml.doc->>'date', '') IS NOT NULL
      AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date >= (ml.doc->>'date')::date
    ORDER BY s.voucher_no
    ON CONFLICT (invoice) DO NOTHING
    RETURNING invoice
  `));
  const [summary] = rowsOf<{ converted: number; latest: string | null }>(await db.execute(sql`
    SELECT
      (SELECT count(DISTINCT ml.phone)::int FROM marketing_leads ml JOIN marketing_sales ms ON ms.phone = ml.phone
        WHERE ml.doc->>'date' >= ${LEADS_FROM} OR ml.doc->>'claimGroup' = ${VIRTUAL_CALLS_GROUP}) AS converted,
      (SELECT to_char(max(billed_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') FROM sales) AS latest
  `));
  return { billsAdded: added.length, convertedLeads: Number(summary?.converted ?? 0), latestBill: summary?.latest ?? null };
}
