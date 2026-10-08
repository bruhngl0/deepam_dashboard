import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { isIntegrationAuthorized } from '@/lib/integration/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_WALK_INS = 5000;
type Row = { id: string; code: string | null; invoice: string | null; amount: string | null; billed_at: string | null };
const resultRows = (result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Row[];

/**
 * What CRM has learned about WalkTrack walk-ins since they were delivered: the
 * Customer ID, and the bill the walk-in was matched to. A walk-in usually
 * arrives before its bill is imported, and the customer may only exist from
 * that import onwards, so WalkTrack asks again for the walk-ins it still holds
 * without an ID or a bill. Read-only.
 */
export async function POST(request: Request) {
  if (!isIntegrationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { walkIns?: unknown } | null;
  const walkIns = body?.walkIns;
  if (!Array.isArray(walkIns) || walkIns.length > MAX_WALK_INS || walkIns.some((id) => typeof id !== 'string')) {
    return Response.json({ error: `Expected { walkIns: string[] } with at most ${MAX_WALK_INS} IDs` }, { status: 422 });
  }

  // Linked visits answer from customer_id. A visit not linked yet is matched on
  // its Contact No., the same rule reconcileStoreVisits applies on the next import.
  // The bill is the one reconcileStoreVisits tied to the visit (pos_sale_id).
  const found = resultRows(await db.execute(sql`
    SELECT sv.external_id AS id, COALESCE(linked.customer_code, by_phone.customer_code) AS code,
      s.voucher_no AS invoice, s.bill_amount::text AS amount, s.billed_at::text AS billed_at
    FROM store_visits sv
    JOIN json_array_elements_text(${JSON.stringify(walkIns)}::json) n ON n.value = sv.external_id
    LEFT JOIN customers linked ON linked.id = sv.customer_id
    LEFT JOIN customers by_phone ON sv.customer_id IS NULL
      AND by_phone.phone_e164 = '+91' || regexp_replace(sv.external_customer_ref, '\\D', '', 'g')
    LEFT JOIN sales s ON s.id = sv.pos_sale_id
    WHERE sv.source_system = 'walktrack' AND sv.deleted_at IS NULL
      AND (COALESCE(linked.customer_code, by_phone.customer_code) IS NOT NULL OR s.id IS NOT NULL)
  `));
  return Response.json({
    customerIds: Object.fromEntries(found.filter((r) => r.code).map((r) => [r.id, r.code])),
    bills: Object.fromEntries(found.filter((r) => r.invoice).map((r) => [r.id, { invoice: r.invoice, amount: r.amount, billedAt: r.billed_at }])),
  });
}
