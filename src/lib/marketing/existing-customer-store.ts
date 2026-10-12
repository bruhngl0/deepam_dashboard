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
