import { db } from '@/db';
import { sql, type SQL } from 'drizzle-orm';

type Row = Record<string, unknown>;

async function query(statement: SQL): Promise<Row[]> {
  const result = (await db.execute(statement)) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

export interface StoreVisitFilters {
  q?: string;
  status?: 'active' | 'deleted';
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
}

export interface StoreVisitRow {
  id: string;
  externalId: string;
  store: string;
  customer: string | null;
  phone: string | null;
  externalCustomerRef: string | null;
  visitedAt: string;
  stoppedAt: string | null;
  people: number;
  staffConverted: boolean;
  source: string | null;
  shoppingIntent: string | null;
  driverCode: string | null;
  deletedAt: string | null;
}

export async function getStoreVisits(filters: StoreVisitFilters) {
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 50));
  const page = Math.max(1, filters.page ?? 1);
  const conditions: SQL[] = [];
  if (filters.status === 'active') conditions.push(sql`sv.deleted_at IS NULL`);
  if (filters.status === 'deleted') conditions.push(sql`sv.deleted_at IS NOT NULL`);
  if (filters.from) conditions.push(sql`sv.visited_at >= ${filters.from}::date`);
  if (filters.to) conditions.push(sql`sv.visited_at < (${filters.to}::date + interval '1 day')`);
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    conditions.push(sql`(c.full_name ILIKE ${term} OR c.phone_e164 ILIKE ${term} OR sv.external_customer_ref ILIKE ${term} OR sv.external_id ILIKE ${term} OR sv.driver_code ILIKE ${term})`);
  }
  const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
  const [rows, counts] = await Promise.all([
    query(sql`
      SELECT sv.id::text AS id, sv.external_id AS "externalId", st.name AS store,
        c.full_name AS customer, c.phone_e164 AS phone,
        sv.external_customer_ref AS "externalCustomerRef", sv.visited_at AS "visitedAt",
        sv.stopped_at AS "stoppedAt", sv.people, sv.staff_converted AS "staffConverted",
        sv.source, sv.shopping_intent AS "shoppingIntent", sv.driver_code AS "driverCode",
        sv.deleted_at AS "deletedAt"
      FROM store_visits sv
      JOIN stores st ON st.id = sv.store_id
      LEFT JOIN customers c ON c.id = sv.customer_id
      ${where}
      ORDER BY sv.visited_at DESC, sv.id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    query(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE deleted_at IS NULL)::int AS active,
        count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
        count(*) FILTER (WHERE customer_id IS NOT NULL)::int AS linked
      FROM store_visits
    `),
  ]);
  const total = Number(counts[0]?.total ?? 0);
  return {
    rows: rows as unknown as StoreVisitRow[],
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    counts: {
      total,
      active: Number(counts[0]?.active ?? 0),
      deleted: Number(counts[0]?.deleted ?? 0),
      linked: Number(counts[0]?.linked ?? 0),
    },
  };
}
