/**
 * One customer across every app: bills, WalkTrack walk-ins, walk-in forms,
 * campaign touches, marketing calls, follow-ups and exhibition bookings.
 *
 * Sources joined by `customer_id` where they carry one (sales, store_visits,
 * walkin_submissions, lead_touches) and by `phone_e164` where they only keep
 * the number (marketing_calls, marketing_call_list_contacts, exhibition_rsvps;
 * all store it as +91…).
 *
 * `marketing_calls.called_at` and the call-list follow-up columns are IST
 * wall-clock times without a zone, so they are read `AT TIME ZONE
 * 'Asia/Kolkata'` to become real instants before they are sorted with the rest.
 *
 * `getCustomerCard` is the short version WalkTrack shows at the counter. It
 * carries no rupee amounts on purpose: the counter is a shared screen.
 */

import { sql } from 'drizzle-orm';
import { possibleCustomerCode, possibleNationalPhone } from '@/lib/integration/events';
import { buyerAggCte, num, query, str, type Row } from './buyers';
import type { ValueTierCode } from '@/lib/format';

export type TimelineKind = 'bill' | 'walkin' | 'form' | 'campaign' | 'call' | 'followup' | 'booking';

export interface TimelineEvent {
  key: string;
  kind: TimelineKind;
  /** ISO instant. */
  at: string;
  title: string;
  details: string[];
  store: string | null;
  /** Salesperson, caller or channel responsible. */
  by: string | null;
  amount: number | null;
}

export interface CustomerHeader {
  id: number;
  customerCode: string | null;
  fullName: string | null;
  phoneE164: string;
  city: string | null;
}

const MAX_EVENTS = 300;
const PER_SOURCE = 200;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const clean = (v: unknown) => {
  const s = str(v)?.trim();
  return s ? s : null;
};
const humanize = (v: unknown) => clean(v)?.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) ?? null;
const compact = (parts: (string | null | undefined | false)[]) => parts.filter((p): p is string => Boolean(p));

/** A Customer ID (CUS-000123) or the numeric row id, as typed in a URL. */
export async function getCustomerHeader(idOrCode: string): Promise<CustomerHeader | null> {
  // Only an explicit CUS- prefix is a Customer ID here; a bare number is the row id the buyer list links to.
  const code = /^CUS-/i.test(idOrCode) ? possibleCustomerCode(idOrCode) : null;
  const id = !code && /^\d{1,18}$/.test(idOrCode) ? Number(idOrCode) : null;
  if (!code && !(id && Number.isSafeInteger(id))) return null;
  const [row] = await query(sql`
    SELECT id, customer_code, full_name, phone_e164, city FROM customers
    WHERE ${code ? sql`customer_code = ${code}` : sql`id = ${id}`} LIMIT 1`);
  return row
    ? { id: num(row.id), customerCode: str(row.customer_code), fullName: str(row.full_name), phoneE164: String(row.phone_e164), city: str(row.city) }
    : null;
}

type Salesperson = { code?: unknown; name?: unknown };
const salespeopleOf = (raw: unknown) =>
  Array.isArray(raw) ? (raw as Salesperson[]).map((s) => clean(s.name) ?? clean(s.code)).filter((s): s is string => Boolean(s)) : [];

const timeOf = (v: unknown) =>
  v ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(v as string)) : null;

export async function getCustomerTimeline(customer: CustomerHeader): Promise<TimelineEvent[]> {
  const { id, phoneE164: phone } = customer;
  const [bills, walkIns, forms, campaigns, calls, followups, bookings] = await Promise.all([
    query(sql`
      SELECT s.id, s.voucher_no, s.billed_at, s.bill_amount, s.salesman_code, st.name AS store,
             COALESCE(s.qty, 0)::float8 AS qty,
             (SELECT ARRAY_AGG(item ORDER BY item) FROM (
                SELECT DISTINCT CONCAT_WS(' · ', NULLIF(li.item_name, ''), NULLIF(li.design_no, ''), NULLIF(li.color_name, ''), NULLIF(li.size, '')) AS item
                FROM sale_line_items li WHERE li.sale_id = s.id AND COALESCE(li.qty, 0) > 0) items
              WHERE item <> '') AS items
      FROM sales s JOIN stores st ON st.id = s.store_id
      WHERE s.customer_id = ${id}
      ORDER BY s.billed_at DESC LIMIT ${PER_SOURCE}`),
    query(sql`
      SELECT sv.id, sv.visited_at, sv.stopped_at, sv.staff_converted, sv.source, sv.shopping_intent, sv.people,
             sv.driver_code, st.name AS store, s.voucher_no,
             sv.raw->>'comments' AS comments, sv.raw->'salespeople' AS salespeople
      FROM store_visits sv JOIN stores st ON st.id = sv.store_id
      LEFT JOIN sales s ON s.id = sv.pos_sale_id
      WHERE sv.customer_id = ${id} AND sv.deleted_at IS NULL
      ORDER BY sv.visited_at DESC LIMIT ${PER_SOURCE}`),
    query(sql`
      SELECT ws.id, ws.submitted_at, ws.how_did_you_hear, ws.purpose_of_visit, st.name AS store
      FROM walkin_submissions ws LEFT JOIN stores st ON st.id = ws.store_id
      WHERE ws.customer_id = ${id}
      ORDER BY ws.submitted_at DESC LIMIT ${PER_SOURCE}`),
    query(sql`
      SELECT lt.id, lt.lead_code, lt.touched_at, lt.touched_at_is_estimated, lt.channel::text AS channel,
             ca.name AS campaign, lf.final_remark::text AS remark, lf.call2_note, st.name AS store
      FROM lead_touches lt JOIN campaigns ca ON ca.id = lt.campaign_id
      LEFT JOIN lead_followups lf ON lf.lead_touch_id = lt.id
      LEFT JOIN stores st ON st.id = lt.store_pref_id
      WHERE lt.customer_id = ${id}
      ORDER BY lt.touched_at DESC LIMIT ${PER_SOURCE}`),
    query(sql`
      SELECT id, (called_at AT TIME ZONE 'Asia/Kolkata') AS at, salesperson, outcome, note
      FROM marketing_calls WHERE phone = ${phone}
      ORDER BY called_at DESC LIMIT ${PER_SOURCE}`),
    query(sql`
      SELECT id, list_name, assigned_to, preferred_store, product, category, followup_note,
             (followup_due AT TIME ZONE 'Asia/Kolkata') AS due,
             (followup_completed_at AT TIME ZONE 'Asia/Kolkata') AS done
      FROM marketing_call_list_contacts
      WHERE phone = ${phone} AND followup_due IS NOT NULL
      ORDER BY followup_due DESC LIMIT ${PER_SOURCE}`),
    query(sql`
      SELECT id, created_at, visit_date, visit_time, party_size
      FROM exhibition_rsvps WHERE phone = ${phone}
      ORDER BY created_at DESC LIMIT ${PER_SOURCE}`),
  ]);

  const events: TimelineEvent[] = [];
  const push = (e: Omit<TimelineEvent, 'at'> & { at: string | null }) => {
    if (e.at) events.push(e as TimelineEvent);
  };

  for (const r of bills) {
    const items = (r.items as string[] | null) ?? [];
    push({
      key: `bill-${r.id}`, kind: 'bill', at: iso(r.billed_at), title: `Bill ${r.voucher_no}`,
      details: compact([items.length ? `Bought: ${items.slice(0, 6).join(', ')}${items.length > 6 ? ` and ${items.length - 6} more` : ''}` : null, num(r.qty) ? `${num(r.qty)} units` : null]),
      store: str(r.store), by: clean(r.salesman_code), amount: num(r.bill_amount),
    });
  }

  for (const r of walkIns) {
    const staff = salespeopleOf(r.salespeople);
    const from = timeOf(r.visited_at); const to = timeOf(r.stopped_at);
    push({
      key: `walkin-${r.id}`, kind: 'walkin', at: iso(r.visited_at),
      title: r.voucher_no ? `Walk-in, billed ${r.voucher_no}` : r.staff_converted ? 'Walk-in, converted' : 'Walk-in, not converted',
      details: compact([
        from && `${from}${to ? ` – ${to}` : ''} · ${num(r.people)} ${num(r.people) === 1 ? 'person' : 'people'}`,
        humanize(r.shopping_intent) && `Looking for: ${humanize(r.shopping_intent)}`,
        humanize(r.source) && `Source: ${humanize(r.source)}`,
        clean(r.driver_code) && `Brought by driver ${clean(r.driver_code)}`,
        clean(r.comments) && `“${clean(r.comments)}”`,
      ]),
      store: str(r.store), by: staff.length ? staff.join(', ') : null, amount: null,
    });
  }

  for (const r of forms) {
    push({
      key: `form-${r.id}`, kind: 'form', at: iso(r.submitted_at), title: 'Walk-in form filled',
      details: compact([humanize(r.purpose_of_visit) && `Purpose: ${humanize(r.purpose_of_visit)}`, humanize(r.how_did_you_hear) && `Heard via: ${humanize(r.how_did_you_hear)}`]),
      store: str(r.store), by: null, amount: null,
    });
  }

  for (const r of campaigns) {
    push({
      key: `campaign-${r.id}`, kind: 'campaign', at: iso(r.touched_at), title: `Campaign: ${r.campaign}`,
      details: compact([
        clean(r.lead_code) && `Lead ID ${clean(r.lead_code)}`,
        r.remark && r.remark !== 'pending' ? `Tele-calling: ${humanize(r.remark)}` : null,
        clean(r.call2_note) && `“${clean(r.call2_note)}”`,
        r.touched_at_is_estimated ? 'Date is the campaign start; the sheet has no per-lead date' : null,
      ]),
      store: str(r.store), by: humanize(r.channel), amount: null,
    });
  }

  for (const r of calls) {
    push({
      key: `call-${r.id}`, kind: 'call', at: iso(r.at), title: `Call: ${clean(r.outcome) ?? 'no outcome recorded'}`,
      details: compact([clean(r.note) && `“${clean(r.note)}”`]),
      store: null, by: clean(r.salesperson), amount: null,
    });
  }

  for (const r of followups) {
    push({
      key: `followup-${r.id}`, kind: 'followup', at: iso(r.due), title: r.done ? 'Follow-up done' : 'Follow-up due',
      details: compact([
        clean(r.followup_note) && `“${clean(r.followup_note)}”`,
        clean(r.product) && `Product: ${compact([clean(r.product), clean(r.category)]).join(', ')}`,
        clean(r.list_name) && `List: ${clean(r.list_name)}`,
      ]),
      store: clean(r.preferred_store), by: clean(r.assigned_to), amount: null,
    });
  }

  for (const r of bookings) {
    push({
      key: `booking-${r.id}`, kind: 'booking', at: iso(r.created_at), title: 'Exhibition appointment booked',
      details: compact([
        r.visit_date ? `For ${String(r.visit_date)}${clean(r.visit_time) ? `, ${clean(r.visit_time)}` : ''}` : null,
        r.party_size ? `${num(r.party_size)} people` : null,
      ]),
      store: 'Shubh Convention', by: null, amount: null,
    });
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_EVENTS);
}

// ── Counter card ─────────────────────────────────────────────────────────────

export interface CustomerCard {
  found: true;
  customerCode: string | null;
  name: string | null;
  /** 'none' when they have never been billed. */
  valueTier: ValueTierCode;
  visits: number;
  lastPurchase: { date: string; store: string; items: string[]; salesmanCode: string | null } | null;
  lastCall: { date: string; by: string; outcome: string | null; preferredStore: string | null; product: string | null } | null;
  openFollowup: { due: string; note: string | null; by: string | null } | null;
  lastWalkIn: { date: string; store: string; converted: boolean; intent: string | null; comment: string | null } | null;
  referredByDriver: string | null;
}

/**
 * The counter's view of a Contact No. (or Customer ID). `excludeWalkIn` is the
 * WalkTrack walk-in being looked at, so its own visit is not reported as the
 * "last walk-in".
 */
export async function getCustomerCard(contactNo: string, excludeWalkIn?: string): Promise<CustomerCard | { found: false }> {
  const national = possibleNationalPhone(contactNo);
  const code = possibleCustomerCode(contactNo);
  if (!national && !code) return { found: false };
  const [customer] = await query(sql`
    SELECT id, customer_code, full_name, phone_e164 FROM customers
    WHERE ${national ? sql`phone_national = ${national}` : sql`customer_code = ${code}`} LIMIT 1`);
  if (!customer) return { found: false };
  const id = num(customer.id);
  const phone = String(customer.phone_e164);

  const [tier, purchase, call, followup, walkIn, driver] = await Promise.all([
    query(sql`${sql.raw(`WITH ${buyerAggCte({})}`)}
      SELECT t.value_tier, b.visits FROM buyer_agg b JOIN tiered t ON t.customer_id = b.customer_id WHERE b.customer_id = ${id}`),
    query(sql`
      SELECT s.billed_at, st.name AS store, s.salesman_code,
             (SELECT ARRAY_AGG(DISTINCT li.item_name) FROM sale_line_items li
              WHERE li.sale_id = s.id AND COALESCE(li.qty, 0) > 0 AND NULLIF(li.item_name, '') IS NOT NULL) AS items
      FROM sales s JOIN stores st ON st.id = s.store_id
      WHERE s.customer_id = ${id} ORDER BY s.billed_at DESC LIMIT 1`),
    query(sql`
      SELECT (c.called_at AT TIME ZONE 'Asia/Kolkata') AS at, c.salesperson, c.outcome,
             (SELECT preferred_store FROM marketing_call_list_contacts l WHERE l.phone = c.phone AND l.preferred_store IS NOT NULL ORDER BY l.updated_at DESC LIMIT 1) AS preferred_store,
             (SELECT product FROM marketing_call_list_contacts l WHERE l.phone = c.phone AND l.product IS NOT NULL ORDER BY l.updated_at DESC LIMIT 1) AS product
      FROM marketing_calls c WHERE c.phone = ${phone} ORDER BY c.called_at DESC LIMIT 1`),
    query(sql`
      SELECT (followup_due AT TIME ZONE 'Asia/Kolkata') AS due, followup_note, assigned_to
      FROM marketing_call_list_contacts
      WHERE phone = ${phone} AND followup_due IS NOT NULL AND followup_completed_at IS NULL
      ORDER BY followup_due ASC LIMIT 1`),
    query(sql`
      SELECT sv.visited_at, st.name AS store, (sv.staff_converted OR sv.pos_sale_id IS NOT NULL) AS converted,
             sv.shopping_intent, sv.raw->>'comments' AS comments
      FROM store_visits sv JOIN stores st ON st.id = sv.store_id
      WHERE sv.customer_id = ${id} AND sv.deleted_at IS NULL
        AND sv.external_id IS DISTINCT FROM ${excludeWalkIn ?? null}
      ORDER BY sv.visited_at DESC LIMIT 1`),
    query(sql`
      SELECT driver_code FROM store_visits
      WHERE customer_id = ${id} AND deleted_at IS NULL AND NULLIF(driver_code, '') IS NOT NULL
      ORDER BY visited_at DESC LIMIT 1`),
  ]);

  const one = (rows: Row[]) => rows[0];
  const p = one(purchase); const c = one(call); const f = one(followup); const w = one(walkIn);
  return {
    found: true,
    customerCode: str(customer.customer_code),
    name: clean(customer.full_name),
    valueTier: (str(one(tier)?.value_tier) as ValueTierCode | null) ?? 'none',
    visits: num(one(tier)?.visits),
    lastPurchase: p
      ? { date: iso(p.billed_at)!, store: String(p.store), items: ((p.items as string[] | null) ?? []).slice(0, 3), salesmanCode: clean(p.salesman_code) }
      : null,
    lastCall: c
      ? { date: iso(c.at)!, by: String(c.salesperson), outcome: clean(c.outcome), preferredStore: clean(c.preferred_store), product: clean(c.product) }
      : null,
    openFollowup: f ? { due: iso(f.due)!, note: clean(f.followup_note), by: clean(f.assigned_to) } : null,
    lastWalkIn: w
      ? { date: iso(w.visited_at)!, store: String(w.store), converted: Boolean(w.converted), intent: humanize(w.shopping_intent), comment: clean(w.comments) }
      : null,
    referredByDriver: clean(one(driver)?.driver_code),
  };
}
