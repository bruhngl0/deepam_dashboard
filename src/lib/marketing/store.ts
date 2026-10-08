/**
 * Shared storage for Marketing Intelligence leads and bills.
 *
 * Uses the HTTP driver only, so nothing here is transactional. Every write is
 * instead safe on its own: a new lead is `ON CONFLICT DO NOTHING` on its phone,
 * an existing lead is updated only when the caller holds its current version,
 * and a bill is `ON CONFLICT DO NOTHING` on its invoice. A writer that loses
 * gets the id back in `conflicts` and reloads.
 */

import { and, asc, count, eq, gt, sql, sum } from 'drizzle-orm';
import { db } from '@/db';
import { marketingLeads, marketingSales } from '@/db/schema';
import type { Dataset, Lead, Sale } from './local';

const INSERT_CHUNK = 500;
const UPDATE_CONCURRENCY = 8;
const PHONE = /^\+91\d{10}$/;
const MAX_DOC_BYTES = 256 * 1024;

export type LeadWrite = { lead: Lead; version: number };
export type SaveResult = { versions: Record<string, number>; conflicts: string[]; inserted: number; updated: number; sales: number };

/** Changes whenever any lead or bill is added or edited: versions only ever grow. */
export async function datasetStamp(): Promise<string> {
  const [[leads], [sales]] = await Promise.all([
    db.select({ n: count(), v: sum(marketingLeads.version) }).from(marketingLeads),
    db.select({ n: count() }).from(marketingSales),
  ]);
  return `${leads.n}:${leads.v ?? 0}:${sales.n}`;
}

export async function leadPage(after: number, limit: number) {
  const rows = await db.select({ seq: marketingLeads.seq, doc: marketingLeads.doc, version: marketingLeads.version })
    .from(marketingLeads).where(gt(marketingLeads.seq, after)).orderBy(asc(marketingLeads.seq)).limit(limit);
  return { rows: rows.map((r) => ({ lead: r.doc as Lead, version: r.version })), next: rows.length === limit ? rows[rows.length - 1].seq : null };
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

export async function saveChanges(leads: LeadWrite[], sales: Sale[]): Promise<SaveResult> {
  const result: SaveResult = { versions: {}, conflicts: [], inserted: 0, updated: 0, sales: 0 };

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
