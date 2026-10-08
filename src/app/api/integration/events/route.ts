import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { txDb } from '@/db';
import { isIntegrationAuthorized } from '@/lib/integration/auth';
import { canonicalStoreCode, parseWalktrackEvent, possibleCustomerCode, possibleNationalPhone } from '@/lib/integration/events';
import { reconcileStoreVisits } from '@/lib/integration/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isIntegrationAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const event = parseWalktrackEvent(await request.json().catch(() => null));
  if (!event) return NextResponse.json({ error: 'Invalid event' }, { status: 422 });

  const storeCode = canonicalStoreCode(event.data.store);
  if (!storeCode) return NextResponse.json({ error: 'Unknown store' }, { status: 422 });

  const { db, pool } = txDb();
  const eventJson = JSON.stringify(event);
  const dataJson = JSON.stringify(event.data);
  try {
    const outcome = await db.transaction(async (tx) => {
      const inserted = await tx.execute(sql`
        INSERT INTO integration_inbox (event_id, source, event_type, entity_id, payload, occurred_at)
        VALUES (${event.eventId}::uuid, ${event.source}, ${event.type}, ${event.entityId}, ${eventJson}::jsonb, ${event.occurredAt}::timestamptz)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      `);
      if (inserted.rows.length === 0) return 'duplicate';

      if (event.type === 'walkin.deleted') {
        await tx.execute(sql`
          UPDATE store_visits SET deleted_at=${event.occurredAt}::timestamptz, updated_at=now(), raw=${dataJson}::jsonb
          WHERE source_system='walktrack' AND external_id=${event.entityId}
        `);
        return 'processed';
      }

      // WalkTrack's Contact No. Events queued before the field was renamed carry it as customerId.
      const customerRef = String(event.data.contactNo ?? event.data.customerId ?? '');
      const phone = possibleNationalPhone(customerRef);
      const customerCode = possibleCustomerCode(customerRef);
      const visitedAt = String(event.data.startTime ?? '');
      const sourceUpdatedAt = String(event.data.updatedAt ?? event.occurredAt);
      if (Number.isNaN(Date.parse(visitedAt)) || Number.isNaN(Date.parse(sourceUpdatedAt))) {
        throw new Error('WalkTrack event has invalid timestamps');
      }
      const people = Math.max(1, Number(event.data.menCount ?? 0) + Number(event.data.womenCount ?? 0) + Number(event.data.childrenCount ?? 0));

      await tx.execute(sql`
        INSERT INTO store_visits
          (source_system, external_id, store_id, customer_id, external_customer_ref, visited_at, stopped_at,
           staff_converted, source, shopping_intent, people, driver_code, raw, source_updated_at, deleted_at)
        SELECT 'walktrack', ${event.entityId}, st.id, c.id, ${customerRef},
          ${visitedAt}::timestamptz, ${event.data.stopTime ? String(event.data.stopTime) : null}::timestamptz,
          ${event.data.converted === true}, ${event.data.source ? String(event.data.source) : null},
          ${event.data.shoppingIntent ? String(event.data.shoppingIntent) : null}, ${people},
          ${event.data.driverSerial ? String(event.data.driverSerial) : null}, ${dataJson}::jsonb,
          ${sourceUpdatedAt}::timestamptz, NULL
        FROM stores st
        LEFT JOIN customers c ON c.phone_national=${phone} OR c.customer_code=${customerCode}
        WHERE st.code=${storeCode}
        ON CONFLICT (source_system, external_id) DO UPDATE SET
          store_id=excluded.store_id, customer_id=COALESCE(excluded.customer_id, store_visits.customer_id),
          external_customer_ref=excluded.external_customer_ref, visited_at=excluded.visited_at,
          stopped_at=excluded.stopped_at, staff_converted=excluded.staff_converted, source=excluded.source,
          shopping_intent=excluded.shopping_intent, people=excluded.people, driver_code=excluded.driver_code,
          raw=excluded.raw, source_updated_at=excluded.source_updated_at, deleted_at=NULL, updated_at=now()
        WHERE excluded.source_updated_at >= store_visits.source_updated_at
      `);
      return 'processed';
    });
    // Hand CRM's Customer ID back so WalkTrack can show the same number. (INTEGRATION.md)
    const resolved = outcome === 'processed' && event.type !== 'walkin.deleted'
      ? await db.execute(sql`
          SELECT c.customer_code FROM store_visits sv JOIN customers c ON c.id = sv.customer_id
          WHERE sv.source_system='walktrack' AND sv.external_id=${event.entityId}`)
      : null;
    const customerCode = (resolved?.rows[0]?.customer_code as string | undefined) ?? null;
    const reconciled = outcome === 'processed' && event.type !== 'walkin.deleted'
      ? await reconcileStoreVisits(event.entityId)
      : 0;
    return NextResponse.json({ status: outcome, salesReconciled: reconciled, customerCode });
  } catch (error) {
    console.error('integration/events', error);
    return NextResponse.json({ error: 'Event processing failed' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
