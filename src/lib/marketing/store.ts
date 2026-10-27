/**
 * Shared storage for Marketing Intelligence leads and bills.
 *
 * Uses the HTTP driver only, so nothing here is transactional. Every write is
 * instead safe on its own: a new lead is `ON CONFLICT DO NOTHING` on its phone,
 * an existing lead is updated only when the caller holds its current version,
 * and a bill is `ON CONFLICT DO NOTHING` on its invoice. A writer that loses
 * gets the id back in `conflicts` and reloads.
 */

import { and, asc, count, eq, gt, sql, sum, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { marketingLeads, marketingSales } from '@/db/schema';
import type { Dataset, Lead, Sale } from './local';
import { EXHB_TAG, VIRTUAL_CALLS_GROUP, type ClaimRouting } from './sheet-routing';

export type { ClaimRouting };

const INSERT_CHUNK = 500;
const UPDATE_CONCURRENCY = 8;
const PHONE = /^\+91\d{10}$/;
const MAX_DOC_BYTES = 256 * 1024;

/**
 * Marketing Intelligence shows and hands out only leads dated on or after this
 * day, plus Virtual calls leads and exhibition form registrations of any date;
 * older leads stay in the table (the Google Sheet sync still merges against
 * them) but are hidden from every page and calling queue.
 */
export const LEADS_FROM = '2026-10-01';
// Also shown whatever their date: Virtual calls leads, exhibition-form leads, and leads put on a
// salesperson's desk by hand (claimPinned), so an older lead assigned to someone shows on their desk.
export const shownWhere = (doc: SQL) => sql`(${doc}->>'date' >= ${LEADS_FROM} OR ${doc}->>'claimGroup' = ${VIRTUAL_CALLS_GROUP} OR jsonb_exists(${doc}->'tags', ${EXHB_TAG}) OR (${doc}->>'claimPinned' = 'true' AND COALESCE(${doc}->>'claimedBy', '') <> ''))`;
const shown = shownWhere(sql`ml.doc`);

export type LeadWrite = { lead: Lead; version: number };
export type SaveResult = { versions: Record<string, number>; conflicts: string[]; inserted: number; updated: number; sales: number };

/**
 * Leads in a salesperson's calling queue: claimed by them, no call logged, not
 * closed and not converted. Mirrors the queue in the salesperson workspace.
 */
export async function openQueueCount(salesperson: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM marketing_leads ml
    WHERE ml.doc->>'claimedBy' = ${salesperson}
      AND ${shown}
      AND COALESCE(ml.doc->>'status', 'New') NOT IN ('Connected / not interested', 'Wrong number')
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(ml.doc->'interactions', '[]'::jsonb)) interaction
        WHERE interaction->>'type' = 'call'
      )
      AND NOT EXISTS (SELECT 1 FROM marketing_sales ms WHERE ms.phone = ml.phone)
  `) as unknown;
  const rows = Array.isArray(result) ? result : (result as { rows?: { n: number }[] }).rows ?? [];
  return Number((rows as { n: number }[])[0]?.n ?? 0);
}

export async function claimLeads(salesperson: string, claimedAt: string, limit = 10, routing: ClaimRouting = { exclude: [] }): Promise<string[]> {
  const group = sql`COALESCE(ml.doc->>'claimGroup', '')`;
  const groups = (list: string[]) => sql.join(list.map((g) => sql`${g}`), sql`, `);
  const routingFilter = 'only' in routing
    ? sql`AND ${group} IN (${groups(routing.only)})`
    : routing.exclude.length
      ? sql`AND ${group} NOT IN (${groups(routing.exclude)})`
      : sql``;
  const first = 'exclude' in routing && routing.first?.length ? sql`(${group} IN (${groups(routing.first)})) DESC, ` : sql``;
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT ml.id
      FROM marketing_leads ml
      WHERE COALESCE(ml.doc->>'claimedBy', '') = ''
        AND ${shown}
        AND COALESCE(ml.doc->>'status', 'New') NOT IN ('Connected / not interested', 'Wrong number')
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(ml.doc->'interactions', '[]'::jsonb)) interaction
          WHERE interaction->>'type' = 'call'
        )
        AND NOT EXISTS (SELECT 1 FROM marketing_sales ms WHERE ms.phone = ml.phone)
        ${routingFilter}
      ORDER BY ${first}ml.seq
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE marketing_leads ml
    SET doc = jsonb_set(
          jsonb_set(ml.doc, '{claimedBy}', to_jsonb(${salesperson}::text), true),
          '{claimedAt}', to_jsonb(${claimedAt}::text), true
        ),
        version = ml.version + 1,
        updated_at = now()
    FROM candidates
    WHERE ml.id = candidates.id
    RETURNING ml.id
  `) as unknown;
  const rows = Array.isArray(result) ? result : (result as { rows?: { id: string }[] }).rows ?? [];
  return (rows as { id: string }[]).map(row => row.id);
}

/** Changes whenever any lead or bill is added or edited: versions only ever grow. */
export async function datasetStamp(): Promise<string> {
  const [[leads], [sales]] = await Promise.all([
    db.select({ n: count(), v: sum(marketingLeads.version) }).from(marketingLeads),
    db.select({ n: count() }).from(marketingSales),
  ]);
  return `${leads.n}:${leads.v ?? 0}:${sales.n}`;
}

/** `shownOnly` limits the page to the leads Marketing Intelligence shows (see LEADS_FROM). */
export async function leadPage(after: number, limit: number, shownOnly = false) {
  // Each lead comes with CRM's IDs for its person: the Lead ID, and the Customer ID once they are a
  // customer (drizzle/0026). They are display-only: saveChanges strips them before writing.
  const rows = await db.select({
    seq: marketingLeads.seq, doc: marketingLeads.doc, version: marketingLeads.version,
    leadCode: sql<string | null>`(SELECT person_lead_code(c.id) FROM customers c WHERE c.phone_e164 = ${marketingLeads.phone})`,
    customerCode: sql<string | null>`(SELECT c.customer_code FROM customers c WHERE c.phone_e164 = ${marketingLeads.phone})`,
  })
    .from(marketingLeads)
    .where(shownOnly ? and(gt(marketingLeads.seq, after), shownWhere(sql`${marketingLeads.doc}`)) : gt(marketingLeads.seq, after))
    .orderBy(asc(marketingLeads.seq)).limit(limit);
  return {
    rows: rows.map((r) => ({ lead: { ...(r.doc as Lead), leadCode: r.leadCode ?? null, customerCode: r.customerCode ?? null }, version: r.version })),
    next: rows.length === limit ? rows[rows.length - 1].seq : null,
  };
}

/** The lead as stored: without the display-only CRM IDs that leadPage adds. */
function stored(lead: Lead): Lead {
  const { leadCode: _lead, customerCode: _customer, ...doc } = lead;
  void _lead; void _customer;
  return doc;
}

export async function salePage(after: number, limit: number) {
  const rows = await db.select().from(marketingSales).where(gt(marketingSales.seq, after)).orderBy(asc(marketingSales.seq)).limit(limit);
  return {
    rows: rows.map((r): Sale => ({ phone: r.phone, invoice: r.invoice, amount: r.amount === null ? null : Number(r.amount), date: r.soldAt, store: r.store })),
    next: rows.length === limit ? rows[rows.length - 1].seq : null,
  };
}

/** The whole dataset, for the server-side sync. */
export async function loadDataset(): Promise<{ data: Dataset; versions: Record<string, number> }> {
  const leads: Lead[] = []; const sales: Sale[] = []; const versions: Record<string, number> = {};
  for (let after: number | null = 0; after !== null;) {
    const page = await leadPage(after, 2000);
    for (const { lead, version } of page.rows) { leads.push(lead); versions[lead.id] = version; }
    after = page.next;
  }
  for (let after: number | null = 0; after !== null;) {
    const page = await salePage(after, 5000);
    sales.push(...page.rows);
    after = page.next;
  }
  return { data: { version: 2, demo: false, leads, sales }, versions };
}

export function isLead(value: unknown): value is Lead {
  const l = value as Lead | null;
  return !!l && typeof l === 'object' && typeof l.id === 'string' && /^LD-[\w-]{1,80}$/.test(l.id) && typeof l.phone === 'string' && PHONE.test(l.phone)
    && typeof l.name === 'string' && !!l.name.trim() && typeof l.source === 'string' && typeof l.status === 'string'
    && Array.isArray(l.acquisitions) && l.acquisitions.length > 0 && Array.isArray(l.interactions) && Array.isArray(l.followups)
    && JSON.stringify(l).length <= MAX_DOC_BYTES;
}

export function isSale(value: unknown): value is Sale {
  const s = value as Sale | null;
  return !!s && typeof s === 'object' && typeof s.invoice === 'string' && !!s.invoice.trim() && s.invoice.length <= 200 && typeof s.phone === 'string' && PHONE.test(s.phone)
    && (s.amount === null || (typeof s.amount === 'number' && Number.isFinite(s.amount) && s.amount > 0)) && typeof s.date === 'string' && typeof s.store === 'string';
}

export async function saveChanges(writes: LeadWrite[], sales: Sale[]): Promise<SaveResult> {
  const result: SaveResult = { versions: {}, conflicts: [], inserted: 0, updated: 0, sales: 0 };
  const leads = writes.map((w) => ({ ...w, lead: stored(w.lead) }));

  const fresh = leads.filter((w) => w.version === 0);
  for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
    const chunk = fresh.slice(i, i + INSERT_CHUNK);
    const done = await db.insert(marketingLeads).values(chunk.map(({ lead }) => ({ id: lead.id, phone: lead.phone, doc: lead })))
      .onConflictDoNothing().returning({ id: marketingLeads.id });
    const ids = new Set(done.map((r) => r.id));
    for (const { lead } of chunk) {
      if (ids.has(lead.id)) { result.versions[lead.id] = 1; result.inserted++; } else result.conflicts.push(lead.id);
    }
  }

  const existing = leads.filter((w) => w.version > 0);
  for (let i = 0; i < existing.length; i += UPDATE_CONCURRENCY) {
    await Promise.all(existing.slice(i, i + UPDATE_CONCURRENCY).map(async ({ lead, version }) => {
      // The phone is the identity key, so an update can never move a lead to another number.
      const [row] = await db.update(marketingLeads)
        .set({ doc: lead, version: sql`${marketingLeads.version} + 1`, updatedAt: sql`now()` })
        .where(and(eq(marketingLeads.id, lead.id), eq(marketingLeads.phone, lead.phone), eq(marketingLeads.version, version)))
        .returning({ version: marketingLeads.version });
      if (row) { result.versions[lead.id] = row.version; result.updated++; } else result.conflicts.push(lead.id);
    }));
  }

  for (let i = 0; i < sales.length; i += INSERT_CHUNK) {
    const done = await db.insert(marketingSales)
      .values(sales.slice(i, i + INSERT_CHUNK).map((s) => ({ invoice: s.invoice, phone: s.phone, amount: s.amount === null ? null : s.amount.toFixed(2), soldAt: s.date, store: s.store })))
      .onConflictDoNothing().returning({ invoice: marketingSales.invoice });
    result.sales += done.length;
  }
  return result;
}

/**
 * Creates or edits the lead for one phone from the server, outside any browser
 * session. `build` gets the stored lead (or null) and may run more than once:
 * the write is retried when another writer gets in first.
 */
export async function upsertLeadByPhone(phone: string, build: (existing: Lead | null) => Lead): Promise<Lead> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db.select({ doc: marketingLeads.doc, version: marketingLeads.version }).from(marketingLeads).where(eq(marketingLeads.phone, phone)).limit(1);
    const lead = build(row ? row.doc as Lead : null);
    const saved = await saveChanges([{ lead, version: row?.version ?? 0 }], []);
    if (!saved.conflicts.length) return lead;
  }
  throw new Error(`Lead for ${phone} kept changing; gave up after 5 attempts.`);
}
