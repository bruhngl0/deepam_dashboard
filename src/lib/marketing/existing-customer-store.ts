import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { marketingCallListContacts, marketingCalls } from '@/db/schema';
import { EXHIBITION_LIST_KEY } from './existing-customer-import';

export type ExistingCustomerDeskRow = {
  id: number;
  name: string;
  phone: string;
  branch: string;
  city: string;
  sourceCustomerId: string | null;
  claimedAt: string;
  preferredStore: string;
  product: string;
  category: string;
  followupDue: string | null;
  followupNote: string;
};

type DeskSummary = { assigned_total: number; remaining: number; open: number; called: number };

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows?: T[] }).rows ?? []) as T[];
}

const leadIdSql = sql`'existing-customer:' || contact.id::text`;

export async function existingCustomerDesk(salesperson: string) {
  const [summaryResult, queueResult, followupResult] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS assigned_total,
        count(*) FILTER (WHERE contact.claimed_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM marketing_calls call WHERE call.lead_id = ${leadIdSql}
        ))::int AS remaining,
        count(*) FILTER (WHERE contact.claimed_at IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM marketing_calls call WHERE call.lead_id = ${leadIdSql}
        ))::int AS open,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM marketing_calls call WHERE call.lead_id = ${leadIdSql}
        ))::int AS called
      FROM marketing_call_list_contacts contact
      WHERE contact.list_key = ${EXHIBITION_LIST_KEY}
        AND lower(contact.assigned_to) = lower(${salesperson})
    `),
    db.execute(sql`
      SELECT contact.id, contact.name, contact.phone, contact.branch, contact.city,
             contact.source_customer_id, contact.claimed_at, contact.preferred_store,
             contact.product, contact.category, contact.followup_due, contact.followup_note
      FROM marketing_call_list_contacts contact
      WHERE contact.list_key = ${EXHIBITION_LIST_KEY}
        AND lower(contact.assigned_to) = lower(${salesperson})
        AND contact.claimed_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM marketing_calls call WHERE call.lead_id = ${leadIdSql}
        )
      ORDER BY contact.claimed_at, contact.id
    `),
    db.execute(sql`
      SELECT contact.id, contact.name, contact.phone, contact.branch, contact.city,
             contact.source_customer_id, contact.claimed_at, contact.preferred_store,
             contact.product, contact.category, contact.followup_due, contact.followup_note
      FROM marketing_call_list_contacts contact
      WHERE contact.list_key = ${EXHIBITION_LIST_KEY}
        AND lower(contact.assigned_to) = lower(${salesperson})
        AND contact.followup_due IS NOT NULL
        AND contact.followup_completed_at IS NULL
      ORDER BY contact.followup_due, contact.id
    `),
  ]);
  const summary = rowsOf<DeskSummary>(summaryResult)[0] ?? { assigned_total: 0, remaining: 0, open: 0, called: 0 };
  return {
    assignedTotal: Number(summary.assigned_total),
    remaining: Number(summary.remaining),
    open: Number(summary.open),
    called: Number(summary.called),
    rows: rowsOf<Record<string, unknown>>(queueResult).map(mapDeskRow),
    followups: rowsOf<Record<string, unknown>>(followupResult).map(mapDeskRow),
  };
}

function mapDeskRow(row: Record<string, unknown>): ExistingCustomerDeskRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    phone: String(row.phone),
    branch: String(row.branch ?? ''),
    city: String(row.city ?? ''),
    sourceCustomerId: row.source_customer_id ? String(row.source_customer_id) : null,
    claimedAt: String(row.claimed_at).replace(' ', 'T'),
    preferredStore: String(row.preferred_store ?? ''),
    product: String(row.product ?? ''),
    category: String(row.category ?? ''),
    followupDue: row.followup_due ? String(row.followup_due).replace(' ', 'T') : null,
    followupNote: String(row.followup_note ?? ''),
  };
}

export type ExistingCustomerKpis = {
  total: number; assigned: number; called: number; calls: number; pending: number; connected: number;
  interested: number; followups: number; overdue: number; converted: number; revenue: number;
};
export const EXISTING_CUSTOMER_VIEWS = ['all', 'called', 'pending', 'interested', 'followups', 'converted'] as const;
export type ExistingCustomerView = (typeof EXISTING_CUSTOMER_VIEWS)[number];
/** `from` and `to` are IST days (YYYY-MM-DD); `store` is a branch name from the list. Empty means no limit. */
export type ExistingCustomerFilters = { from?: string; to?: string; store?: string };
export type ExistingCustomerListRow = {
  id: number; sourceCustomerId: string | null; name: string; phone: string; branch: string; city: string; assignedTo: string | null;
  lastCalledAt: string | null; lastOutcome: string; lastNote: string; followupDue: string | null; followupNote: string; billed: number | null;
};

const PAGE_SIZE = 50;
const isoSql = (column: string) => sql.raw(`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS')`);

/**
 * The calling list joined to each customer's calls and bills, shared by the
 * KPI cards and the lists behind them so the two always agree.
 *
 * The list size and Pending describe the list as it stands, so they ignore the
 * dates. Called, Interested and Converted count calls and bills dated inside
 * the period, and Follow-ups due counts open follow-ups falling due in it.
 * Connected and Interested go by the latest call in the period. Converted
 * follows Team performance: only bills on or after the day the customer was
 * claimed count, since everyone on this list has bought before.
 */
function listQuery(filters: ExistingCustomerFilters) {
  const from = filters.from || null, to = filters.to || null;
  const within = (column: string) => sql`(${from}::date IS NULL OR ${sql.raw(column)} >= ${from}::date) AND (${to}::date IS NULL OR ${sql.raw(column)} < ${to}::date + 1)`;
  const called = within('call.called_at');
  const source = sql`
    WITH calls AS (
      SELECT call.lead_id,
             max(call.called_at) AS last_at,
             (array_agg(call.outcome ORDER BY call.called_at DESC))[1] AS last_outcome,
             (array_agg(call.note ORDER BY call.called_at DESC))[1] AS last_note,
             count(*) FILTER (WHERE ${called})::int AS calls,
             max(call.called_at) FILTER (WHERE ${called}) AS called_at,
             (array_agg(call.outcome ORDER BY call.called_at DESC) FILTER (WHERE ${called}))[1] AS outcome,
             (array_agg(call.note ORDER BY call.called_at DESC) FILTER (WHERE ${called}))[1] AS note
      FROM marketing_calls call
      WHERE call.lead_id LIKE 'existing-customer:%'
      GROUP BY call.lead_id
    ), bills AS (
      SELECT contact.id AS contact_id, sum(sale.amount)::float AS amount
      FROM marketing_call_list_contacts contact
      JOIN marketing_sales sale ON sale.phone = contact.phone
        AND left(sale.sold_at, 10) >= to_char(contact.claimed_at, 'YYYY-MM-DD')
        AND (${from}::text IS NULL OR left(sale.sold_at, 10) >= ${from})
        AND (${to}::text IS NULL OR left(sale.sold_at, 10) <= ${to})
      WHERE contact.list_key = ${EXHIBITION_LIST_KEY} AND contact.claimed_at IS NOT NULL
      GROUP BY contact.id
    )`;
  const joined = sql`
    FROM marketing_call_list_contacts contact
    LEFT JOIN calls ON calls.lead_id = ${leadIdSql}
    LEFT JOIN bills ON bills.contact_id = contact.id
    WHERE contact.list_key = ${EXHIBITION_LIST_KEY}
      AND (${filters.store || null}::text IS NULL OR contact.branch = ${filters.store || null})`;
  const is: Record<Exclude<ExistingCustomerView, 'all'>, ReturnType<typeof sql>> = {
    called: sql`calls.calls > 0`,
    pending: sql`contact.assigned_to IS NOT NULL AND calls.lead_id IS NULL`,
    interested: sql`calls.outcome = 'Connected / interested'`,
    followups: sql`contact.followup_due IS NOT NULL AND contact.followup_completed_at IS NULL AND ${within('contact.followup_due')}`,
    converted: sql`bills.contact_id IS NOT NULL`,
  };
  return { source, joined, is };
}

/** Headline figures for the exhibition calling list. */
export async function existingCustomerKpis(filters: ExistingCustomerFilters = {}): Promise<ExistingCustomerKpis> {
  const { source, joined, is } = listQuery(filters);
  const result = await db.execute(sql`${source}
    SELECT count(*)::int AS total,
      count(contact.assigned_to)::int AS assigned,
      count(*) FILTER (WHERE ${is.called})::int AS called,
      coalesce(sum(calls.calls), 0)::int AS calls,
      count(*) FILTER (WHERE ${is.pending})::int AS pending,
      count(*) FILTER (WHERE calls.outcome LIKE 'Connected%')::int AS connected,
      count(*) FILTER (WHERE ${is.interested})::int AS interested,
      count(*) FILTER (WHERE ${is.followups})::int AS followups,
      count(*) FILTER (WHERE ${is.followups} AND contact.followup_due < (now() AT TIME ZONE 'Asia/Kolkata'))::int AS overdue,
      count(bills.contact_id)::int AS converted,
      coalesce(sum(bills.amount), 0)::float AS revenue
    ${joined}`);
  const row = rowsOf<Record<string, unknown>>(result)[0] ?? {};
  const n = (key: keyof ExistingCustomerKpis) => Number(row[key] ?? 0);
  return {
    total: n('total'), assigned: n('assigned'), called: n('called'), calls: n('calls'), pending: n('pending'), connected: n('connected'),
    interested: n('interested'), followups: n('followups'), overdue: n('overdue'), converted: n('converted'), revenue: n('revenue'),
  };
}

/** The stores customers on the list belong to, for the store filter. */
export async function existingCustomerStores(): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT contact.branch FROM marketing_call_list_contacts contact
    WHERE contact.list_key = ${EXHIBITION_LIST_KEY} AND contact.branch <> '' ORDER BY contact.branch`);
  return rowsOf<{ branch: string }>(result).map(row => String(row.branch));
}

/** One page of the calling list, narrowed to the customers behind a KPI card. */
export async function existingCustomerPage(view: ExistingCustomerView, search: string, page: number, filters: ExistingCustomerFilters = {}): Promise<{ filtered: number; pageSize: number; rows: ExistingCustomerListRow[] }> {
  const { source, joined, is } = listQuery(filters);
  const like = `%${search}%`;
  const where = sql.join([
    joined,
    ...(search ? [sql`(contact.name ILIKE ${like} OR contact.phone ILIKE ${`%${search.replace(/\s/g, '')}%`} OR contact.source_customer_id ILIKE ${like} OR contact.branch ILIKE ${like} OR contact.assigned_to ILIKE ${like})`] : []),
    ...(view === 'all' ? [] : [is[view]]),
  ], sql` AND `);
  // The called and interested lists are about calls in the period; the others show the customer's latest call of all.
  const inPeriod = view === 'called' || view === 'interested';
  const order = inPeriod ? sql`calls.called_at DESC, contact.id` : view === 'followups' ? sql`contact.followup_due, contact.id` : sql`contact.id`;
  const [countResult, rowResult] = await Promise.all([
    db.execute(sql`${source} SELECT count(*)::int AS filtered ${where}`),
    db.execute(sql`${source}
      SELECT contact.id, contact.source_customer_id, contact.name, contact.phone, contact.branch, contact.city, contact.assigned_to,
             ${isoSql(inPeriod ? 'calls.called_at' : 'calls.last_at')} AS last_called_at,
             ${sql.raw(inPeriod ? 'calls.outcome' : 'calls.last_outcome')} AS last_outcome,
             ${sql.raw(inPeriod ? 'calls.note' : 'calls.last_note')} AS last_note,
             ${isoSql('contact.followup_due')} AS followup_due, contact.followup_note, contact.followup_completed_at IS NULL AS followup_open,
             bills.amount AS billed
      ${where}
      ORDER BY ${order}
      LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`),
  ]);
  return {
    filtered: Number(rowsOf<{ filtered: number }>(countResult)[0]?.filtered ?? 0),
    pageSize: PAGE_SIZE,
    rows: rowsOf<Record<string, unknown>>(rowResult).map(row => ({
      id: Number(row.id),
      sourceCustomerId: row.source_customer_id ? String(row.source_customer_id) : null,
      name: String(row.name),
      phone: String(row.phone),
      branch: String(row.branch ?? ''),
      city: String(row.city ?? ''),
      assignedTo: row.assigned_to ? String(row.assigned_to) : null,
      lastCalledAt: row.last_called_at ? String(row.last_called_at) : null,
      lastOutcome: String(row.last_outcome ?? ''),
      lastNote: String(row.last_note ?? ''),
      followupDue: row.followup_due && row.followup_open ? String(row.followup_due) : null,
      followupNote: String(row.followup_note ?? ''),
      billed: row.billed === null || row.billed === undefined ? null : Number(row.billed),
    })),
  };
}

/** Every claimed existing customer, for the Team performance table. */
export async function existingCustomerClaims(): Promise<{ leadId: string; salesperson: string; phone: string; claimedAt: string; followupDue: string | null }[]> {
  const result = await db.execute(sql`
    SELECT ${leadIdSql} AS lead_id, contact.assigned_to, contact.phone, contact.claimed_at,
           CASE WHEN contact.followup_completed_at IS NULL THEN ${isoSql('contact.followup_due')} END AS followup_due
    FROM marketing_call_list_contacts contact
    WHERE contact.list_key = ${EXHIBITION_LIST_KEY}
      AND contact.assigned_to IS NOT NULL
      AND contact.claimed_at IS NOT NULL
  `);
  return rowsOf<Record<string, unknown>>(result).map(row => ({
    leadId: String(row.lead_id),
    salesperson: String(row.assigned_to),
    phone: String(row.phone),
    claimedAt: String(row.claimed_at).replace(' ', 'T'),
    followupDue: row.followup_due ? String(row.followup_due) : null,
  }));
}

export async function claimExistingCustomers(salesperson: string, limit = 10): Promise<number[]> {
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT contact.id
      FROM marketing_call_list_contacts contact
      WHERE contact.list_key = ${EXHIBITION_LIST_KEY}
        AND lower(contact.assigned_to) = lower(${salesperson})
        AND contact.claimed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM marketing_calls call
          WHERE call.lead_id = 'existing-customer:' || contact.id::text
        )
      ORDER BY contact.id
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE marketing_call_list_contacts contact
    SET claimed_at = now(), updated_at = now()
    FROM candidates
    WHERE contact.id = candidates.id
    RETURNING contact.id
  `);
  return rowsOf<{ id: number }>(result).map(row => Number(row.id));
}

export async function logExistingCustomerCall(input: { id: number; salesperson: string; outcome: string; note: string; calledAt: string; preferredStore: string; product: string; category: string; followupDue: string | null }) {
  const [contact] = await db.select().from(marketingCallListContacts).where(and(
    eq(marketingCallListContacts.id, input.id),
    eq(marketingCallListContacts.listKey, EXHIBITION_LIST_KEY),
  )).limit(1);
  if (!contact) return false;
  const activeFollowup = contact.followupDue && !contact.followupCompletedAt;
  if ((!contact.claimedAt && !activeFollowup) || contact.assignedTo?.toLocaleLowerCase() !== input.salesperson.toLocaleLowerCase()) return false;
  await db.insert(marketingCalls).values({
    id: `existing-customer-${input.id}-${crypto.randomUUID()}`,
    leadId: `existing-customer:${input.id}`,
    leadName: contact.name,
    phone: contact.phone,
    salesperson: input.salesperson,
    outcome: input.outcome,
    note: input.note,
    calledAt: input.calledAt,
  });
  await db.update(marketingCallListContacts).set({
    preferredStore: input.preferredStore || null,
    product: input.product || null,
    category: input.category || null,
    followupDue: input.followupDue,
    followupNote: input.followupDue ? input.note : null,
    followupCompletedAt: input.followupDue ? null : sql`now()`,
    updatedAt: sql`now()`,
  }).where(eq(marketingCallListContacts.id, input.id));
  return true;
}

export async function completeExistingCustomerFollowup(id: number, salesperson: string) {
  const [row] = await db.update(marketingCallListContacts).set({ followupCompletedAt: sql`now()`, updatedAt: sql`now()` }).where(and(
    eq(marketingCallListContacts.id, id),
    eq(marketingCallListContacts.listKey, EXHIBITION_LIST_KEY),
    sql`lower(${marketingCallListContacts.assignedTo}) = lower(${salesperson})`,
    sql`${marketingCallListContacts.followupDue} IS NOT NULL`,
    sql`${marketingCallListContacts.followupCompletedAt} IS NULL`,
  )).returning({ id: marketingCallListContacts.id });
  return !!row;
}
