import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { isIntegrationAuthorized } from '@/lib/integration/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_WALK_INS = 5000;
type Row = { id: string; code: string | null; lead: string | null; invoice: string | null; amount: string | null; billed_at: string | null };
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

  // Every linked visit answers with its person's IDs as they stand now: the Lead ID always, the
  // Customer ID only once they are a customer (drizzle/0026), so WalkTrack can also drop a Customer ID
  // that was taken back from a lead. The bill is the one reconcileStoreVisits tied to the visit.
  const found = resultRows(await db.execute(sql`
    SELECT sv.external_id AS id, c.customer_code AS code, person_lead_code(c.id) AS lead,
      s.voucher_no AS invoice, s.bill_amount::text AS amount, s.billed_at::text AS billed_at
    FROM store_visits sv
    JOIN json_array_elements_text(${JSON.stringify(walkIns)}::json) n ON n.value = sv.external_id
    LEFT JOIN customers c ON c.id = sv.customer_id
    LEFT JOIN sales s ON s.id = sv.pos_sale_id
    WHERE sv.source_system = 'walktrack' AND sv.deleted_at IS NULL
  `));
  return Response.json({
    customerIds: Object.fromEntries(found.filter((r) => r.code).map((r) => [r.id, r.code])),
    people: Object.fromEntries(found.map((r) => [r.id, { customerCode: r.code, leadCode: r.lead }])),
    bills: Object.fromEntries(found.filter((r) => r.invoice).map((r) => [r.id, { invoice: r.invoice, amount: r.amount, billedAt: r.billed_at }])),
  });
}
