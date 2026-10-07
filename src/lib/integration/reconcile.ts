import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * Match one sale to at most one WalkTrack visit and vice versa. Customer, store,
 * and IST business date must agree; nearest timestamp breaks same-day ties.
 */
export async function reconcileStoreVisits(externalId?: string): Promise<number> {
  await db.execute(sql`
    UPDATE store_visits sv SET customer_id=c.id, updated_at=now()
    FROM customers c
    WHERE sv.customer_id IS NULL AND sv.deleted_at IS NULL AND (
      regexp_replace(sv.external_customer_ref, '\\D', '', 'g') = c.phone_national
      OR (sv.external_customer_ref ~ '^\\d{1,9}$' AND c.id::text = sv.external_customer_ref)
      OR c.customer_code = upper(trim(sv.external_customer_ref))
    )
  `);
  const filter = externalId ? sql`AND sv.external_id = ${externalId}` : sql``;
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT sv.id AS visit_id, s.id AS sale_id,
        ROW_NUMBER() OVER (PARTITION BY sv.id ORDER BY ABS(EXTRACT(EPOCH FROM (s.billed_at - sv.visited_at))), s.id) AS visit_rank,
        ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY ABS(EXTRACT(EPOCH FROM (s.billed_at - sv.visited_at))), sv.id) AS sale_rank
      FROM store_visits sv
      JOIN sales s ON s.customer_id = sv.customer_id AND s.store_id = sv.store_id
        AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date = (sv.visited_at AT TIME ZONE 'Asia/Kolkata')::date
      WHERE sv.deleted_at IS NULL AND sv.customer_id IS NOT NULL AND sv.pos_sale_id IS NULL ${filter}
    ), chosen AS (
      SELECT visit_id, sale_id FROM candidates WHERE visit_rank=1 AND sale_rank=1
    )
    UPDATE store_visits sv SET pos_sale_id=chosen.sale_id, updated_at=now()
    FROM chosen WHERE sv.id=chosen.visit_id
    RETURNING sv.id
  `);
  return result.rows.length;
}
