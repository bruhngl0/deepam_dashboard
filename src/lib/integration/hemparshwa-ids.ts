/**
 * Hemparshwa OS takes its Customer, Vendor, Category and Lead IDs from CRM. Hemparshwa's network
 * cannot be relied on to reach CRM, but CRM already calls Hemparshwa on every sync, so CRM reads
 * Hemparshwa's records (GET /api/integration/masters), works out the ID each has here, and sends
 * the pairs back (POST /api/integration/crm-ids), where Hemparshwa renumbers.
 *
 *  - Customers, by phone: only people CRM counts as customers have a CUS- (drizzle/0026). A record
 *    Hemparshwa keeps for a lead gets none and keeps its provisional HCU- ID there.
 *  - Vendors and categories, by name, registered here exactly as POST /api/integration/ids does.
 *  - Leads become CRM lead touches (person by phone, campaign "Hemparshwa — <campaign>"), and their
 *    LED- goes back. Two Hemparshwa leads for one person and campaign share one touch: the earlier
 *    keeps the Lead ID, the other is reported.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { normalizePhone } from '@/lib/phone';
import { registerVendorAndCategoryNames } from './register-names';

type Masters = {
  customers: { id: string; phone: string | null; name: string | null }[];
  vendors: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  leads: { companyId: string; id: string; phone: string | null; name: string | null; campaign: string | null; created: string | null }[];
};
type Pair = { id: string; code: string };
export type HemparshwaIdsResult = {
  sent: { customers: number; vendors: number; categories: number; leads: number };
  applied: { customers: number; vendors: number; categories: number; leads: number } | null;
  skipped: number;
  notMatched: { customers: number; leads: number };
};

const rows = <T>(result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as T[];

async function hemparshwa<T>(path: string, init?: RequestInit): Promise<T> {
  const base = process.env.HEMPARSHWA_URL?.replace(/\/+$/, '');
  const token = process.env.HEMPARSHWA_INTEGRATION_TOKEN;
  if (!base || !token) throw new Error('HEMPARSHWA_URL and HEMPARSHWA_INTEGRATION_TOKEN are not set.');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Hemparshwa ${path} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

const national = (phone: string | null) => {
  const p = phone ? normalizePhone(phone) : null;
  return p?.ok && !p.hadMultiple ? p : null;
};
const day = (value: string | null) => {
  const d = value ? new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
};

/** The pairs to send: exported for tests. */
export async function crmIdsFor(masters: Masters): Promise<{ customers: Pair[]; vendors: Pair[]; categories: Pair[]; leads: (Pair & { companyId: string })[]; notMatched: HemparshwaIdsResult['notMatched'] }> {
  // Customers: by phone, customers only.
  const phones = [...new Set(masters.customers.flatMap((c) => national(c.phone)?.national ?? []))];
  const codeByPhone = new Map(rows<{ phone_national: string; customer_code: string }>(await db.execute(sql`
    SELECT phone_national, customer_code FROM customers
    WHERE customer_code IS NOT NULL AND phone_national IN (SELECT json_array_elements_text(${JSON.stringify(phones)}::json))`)).map((r) => [r.phone_national, r.customer_code]));
  const customers: Pair[] = [];
  let unmatchedCustomers = 0;
  for (const c of masters.customers) {
    const code = codeByPhone.get(national(c.phone)?.national ?? '');
    if (code) customers.push({ id: c.id, code });
    else unmatchedCustomers++;
  }

  // Vendors and categories: by name.
  const registered = await registerVendorAndCategoryNames(
    [...new Set(masters.vendors.map((v) => v.name.trim()).filter(Boolean))],
    [...new Set(masters.categories.map((c) => c.name.trim()).filter(Boolean))],
  );
  const vendors = masters.vendors.flatMap((v) => (registered.vendors[v.name.trim()] ? [{ id: v.id, code: registered.vendors[v.name.trim()] }] : []));
  const categories = masters.categories.flatMap((c) => (registered.categories[c.name.trim()] ? [{ id: c.id, code: registered.categories[c.name.trim()] }] : []));

  // Leads: each becomes a CRM lead touch; its Lead ID goes back.
  const leadsIn = masters.leads.flatMap((l) => {
    const p = national(l.phone);
    return p ? [{ ...l, e164: p.e164, national: p.national, campaign: `Hemparshwa — ${(l.campaign ?? '').trim() || 'Leads'}`.slice(0, 240), at: day(l.created) }] : [];
  });
  const leads: (Pair & { companyId: string })[] = [];
  if (leadsIn.length) {
    const json = JSON.stringify(leadsIn.map((l) => ({ company: l.companyId, id: l.id, e164: l.e164, national: l.national, name: l.name, campaign: l.campaign, at: l.at })));
    const result = await db.transaction(async (t) => {
      await t.execute(sql`CREATE TEMP TABLE hp_leads ON COMMIT DROP AS
        SELECT * FROM json_to_recordset(${json}::json) AS x(company text, id text, e164 text, national text, name text, campaign text, at timestamptz)`);
      await t.execute(sql`INSERT INTO customers (phone_e164, phone_national, full_name, first_seen_at, last_seen_at)
        SELECT DISTINCT ON (e164) e164, national, NULLIF(trim(name), ''), at, at FROM hp_leads ORDER BY e164, at
        ON CONFLICT (phone_e164) DO NOTHING`);
      await t.execute(sql`INSERT INTO campaigns (name, channel, started_on, notes)
        SELECT campaign, 'other', min(at)::date, 'Leads imported in Hemparshwa OS.' FROM hp_leads GROUP BY campaign
        ON CONFLICT (name, started_on) DO NOTHING`);
      await t.execute(sql`INSERT INTO import_batches (source_type, source_kind, file_name, status, committed_at)
        SELECT 'other', 'lead', 'hemparshwa-leads', 'committed', now()
        WHERE NOT EXISTS (SELECT 1 FROM import_batches WHERE file_name = 'hemparshwa-leads' AND source_kind = 'lead')`);
      await t.execute(sql`INSERT INTO lead_touches (customer_id, campaign_id, batch_id, channel, touched_at, raw)
        SELECT DISTINCT ON (c.id, ca.id) c.id, ca.id,
               (SELECT id FROM import_batches WHERE file_name = 'hemparshwa-leads' AND source_kind = 'lead' ORDER BY created_at LIMIT 1),
               'other', h.at, jsonb_build_object('source', 'hemparshwa', 'hemparshwaLeadId', h.id)
        FROM hp_leads h JOIN customers c ON c.phone_e164 = h.e164
        JOIN LATERAL (SELECT id FROM campaigns WHERE name = h.campaign ORDER BY started_on LIMIT 1) ca ON true
        ORDER BY c.id, ca.id, h.at
        ON CONFLICT (customer_id, campaign_id, channel) DO NOTHING`);
      return rows<{ company: string; id: string; code: string | null }>(await t.execute(sql`
        SELECT h.company, h.id, lt.lead_code AS code
        FROM hp_leads h JOIN customers c ON c.phone_e164 = h.e164
        JOIN LATERAL (SELECT id FROM campaigns WHERE name = h.campaign ORDER BY started_on LIMIT 1) ca ON true
        JOIN lead_touches lt ON lt.customer_id = c.id AND lt.campaign_id = ca.id AND lt.channel = 'other'
        ORDER BY h.company, lt.lead_code, h.at, h.id`));
    });
    const taken = new Set<string>();
    for (const r of result) {
      if (!r.code || taken.has(`${r.company}|${r.code}`)) continue;
      taken.add(`${r.company}|${r.code}`);
      leads.push({ companyId: r.company, id: r.id, code: r.code });
    }
  }

  return {
    customers: customers.filter((p) => p.id !== p.code),
    vendors: vendors.filter((p) => p.id !== p.code),
    categories: categories.filter((p) => p.id !== p.code),
    leads: leads.filter((p) => p.id !== p.code),
    notMatched: { customers: unmatchedCustomers, leads: masters.leads.length - leads.length },
  };
}

/** Run at the end of each Hemparshwa sync (hemparshwa-schedule.ts). */
export async function assignHemparshwaIds(): Promise<HemparshwaIdsResult> {
  const masters = await hemparshwa<Masters>('/api/integration/masters');
  const { notMatched, ...pairs } = await crmIdsFor(masters);
  const sent = { customers: pairs.customers.length, vendors: pairs.vendors.length, categories: pairs.categories.length, leads: pairs.leads.length };
  if (!sent.customers && !sent.vendors && !sent.categories && !sent.leads) return { sent, applied: null, skipped: 0, notMatched };
  const applied = await hemparshwa<{ customers: number; vendors: number; categories: number; leads: number; skipped: unknown[] }>(
    '/api/integration/crm-ids', { method: 'POST', body: JSON.stringify(pairs) },
  );
  if (applied.skipped.length) console.warn('[hemparshwa ids] skipped', JSON.stringify(applied.skipped.slice(0, 20)));
  return { sent, applied: { customers: applied.customers, vendors: applied.vendors, categories: applied.categories, leads: applied.leads }, skipped: applied.skipped.length, notMatched };
}
