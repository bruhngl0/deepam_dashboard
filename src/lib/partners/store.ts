/**
 * Ananta Partner Network writes: applications, referral registrations, partner decisions, documents, commission validation
 * and payouts. The rules themselves are SQL so a page load, a registration and a test all apply the same ones:
 * referral matching (drizzle/0039), and the program rules v1.0 (drizzle/0047): whole-month commission and bonus
 * (partner_refresh_months) and month-end partnership level reviews (partner_run_reviews).
 */

import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { upsertLeadByPhone } from '@/lib/marketing/store';
import { LEVELS, normalizePartnerCode, PARTNER_CODE, PARTNER_DOCUMENTS, PARTNER_STATUS_LABEL, REFERRAL_BRANDS, REFERRAL_STORES, STATUS_MOVES, type DeclineReason, type PartnerStatus } from './constants';
import { isBot, parseApplication, parseReferral, type Read } from './forms';
import { withPartnerReferral } from './lead';

export const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const newToken = () => randomBytes(24).toString('base64url');

export class PartnerError extends Error {}

/**
 * Brings everything up to date (idempotent): matches new bills to referrals, recalculates each unpaid month (net values,
 * commission level, whole-month commission and bonus), then runs any month-end level review that is due.
 */
export async function refreshReferrals(): Promise<void> {
  // One at a time across requests: every page load runs this, and two at once would race on the same rows.
  await db.transaction(async (t) => {
    await t.execute(sql`SELECT pg_advisory_xact_lock(hashtext('partner-refresh'))`);
    await t.execute(sql`SELECT partner_refresh_referrals()`);
    await t.execute(sql`SELECT partner_detect_flags()`); // fraud flags hold bills (0048)
    await t.execute(sql`SELECT partner_refresh_months()`); // holds, exclusions, campaigns, then each unsettled month
    await t.execute(sql`SELECT partner_run_reviews()`);
    await t.execute(sql`SELECT partner_evaluate_incentives()`);
    await t.execute(sql`SELECT partner_detect_adjustments()`); // settled months that changed since → next statement
    await t.execute(sql`SELECT partner_refresh_settlements()`);
  });
}

// ── Public forms ──────────────────────────────────────────────────────────────

export type ApplyResult = { kind: 'saved' | 'existing' } | { kind: 'invalid'; message: string };

/** Saves a partner application. A phone that already applied is not saved again. */
export async function applyAsPartner(read: Read): Promise<ApplyResult> {
  if (isBot(read)) return { kind: 'saved' };
  const categories = rowsOf<{ name: string }>(await db.execute(sql`SELECT name FROM partner_categories WHERE active`)).map((c) => c.name);
  const parsed = parseApplication(read, categories);
  if (!parsed.ok) return { kind: 'invalid', message: parsed.message };
  const a = parsed.value;
  const inserted = rowsOf<{ id: number }>(await db.execute(sql`
    INSERT INTO partners (full_name, contact, phone_e164, email, category, city, consent_at)
    VALUES (${a.fullName}, ${a.contact}, ${a.phone}, ${a.email}, ${a.category}, ${a.city}, now())
    ON CONFLICT (phone_e164) DO NOTHING RETURNING id`));
  return { kind: inserted.length ? 'saved' : 'existing' };
}

export type ActivePartner = { id: number; code: string; fullName: string; category: string };

/** The approved partner behind a referral link, or null (unknown, not yet approved, rejected or suspended). */
export async function activePartner(code: string): Promise<ActivePartner | null> {
  const upper = normalizePartnerCode(code);
  if (!PARTNER_CODE.test(upper)) return null;
  const [p] = rowsOf<{ id: number; partner_code: string; full_name: string; category: string }>(await db.execute(sql`
    SELECT id, partner_code, full_name, category FROM partners WHERE partner_code = ${upper} AND status = 'approved'`));
  return p ? { id: p.id, code: p.partner_code, fullName: p.full_name, category: p.category } : null;
}

export type ReferResult =
  | { kind: 'saved' }
  | { kind: 'invalid'; message: string }
  | { kind: 'declined'; reason: DeclineReason }
  | { kind: 'inactive' };

/**
 * Registers a customer on a partner's referral link. The number is checked against the CRM first: a number another
 * partner already registered (validity still open), the partner's own number or a store/staff number is not accepted;
 * the attempt is still kept, as declined, for disputes. An existing customer (a bill in the look-back years) is
 * accepted but waits for staff to verify the partner's part before its bills earn. An accepted registration opens a
 * Marketing Intelligence follow-up to confirm the appointment.
 */
export async function registerReferral(partnerCode: string, read: Read): Promise<ReferResult> {
  const partner = await activePartner(partnerCode);
  if (!partner) return { kind: 'inactive' };
  if (isBot(read)) return { kind: 'saved' };
  const parsed = parseReferral(read, todayIst());
  if (!parsed.ok) return { kind: 'invalid', message: parsed.message };
  const r = parsed.value;
  const store = REFERRAL_STORES.find((s) => s.code === r.storeCode)!;
  // Kalaniketan stores aren't CRM stores: kept by name (preferred_store_id stays empty).
  const storeLabel = `${REFERRAL_BRANDS.find((b) => b.key === r.brand)!.label} ${store.label}`;

  const reason = await db.transaction(async (t) => {
    // Two registrations of one number at the same moment must not both be accepted.
    await t.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`partner-referral:${r.phone}`}))`);
    // A referral whose window has closed must read as expired before the number is checked again.
    await t.execute(sql`SELECT partner_refresh_referrals(${r.phone})`);
    const [{ block }] = rowsOf<{ block: DeclineReason | null }>(await t.execute(sql`SELECT partner_referral_block(${r.phone}, ${partner.id}) AS block`));
    await t.execute(sql`
      INSERT INTO partner_referrals (partner_id, full_name, contact, phone_e164, customer_id, occasion, preferred_store_id,
                                     appointment_date, consent_at, status, decline_reason, registered_on, window_ends_on, verify_status,
                                     brand, preferred_store_label)
      SELECT ${partner.id}, ${r.fullName}, ${r.contact}, ${r.phone}, (SELECT id FROM customers WHERE phone_e164 = ${r.phone}),
             ${r.occasion}, (SELECT id FROM stores WHERE code = ${r.storeCode}), ${r.appointmentDate}::date, now(),
             ${block ? 'declined' : 'registered'}, ${block}, d.today, d.today + partner_setting_int('partner_purchase_window_days', 30),
             CASE WHEN ${block}::text IS NULL AND partner_is_existing_customer(${r.phone}) THEN 'pending' END,
             ${r.brand}, ${storeLabel}
      FROM (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today) d`);
    return block;
  });
  if (reason) return { kind: 'declined', reason };

  // The registration is saved; a failure here must not cost the customer their thank-you.
  // Marketing Intelligence follows up Deepam visits only (it has no Kalaniketan stores).
  if (!store.marketing) return { kind: 'saved' };
  await upsertLeadByPhone(r.phone, (existing) => withPartnerReferral(existing, {
    phone: r.phone, name: r.fullName, partnerCode: partner.code, partnerName: partner.fullName, partnerCategory: partner.category,
    occasion: r.occasion, store: store.marketing, storeLabel: store.label, appointmentDate: r.appointmentDate,
  })).catch((error) => console.error('[partners] follow-up not created', error));
  return { kind: 'saved' };
}

// ── Partner decisions ─────────────────────────────────────────────────────────

const level = (v: unknown) => {
  const n = Number(v);
  if (!LEVELS.includes(n as (typeof LEVELS)[number])) throw new PartnerError('Choose a level from 1 to 5');
  return n;
};
const need = (v: string | null | undefined, message: string) => {
  const t = (v ?? '').trim();
  if (!t) throw new PartnerError(message);
  return t;
};

/**
 * Changes a partner's status (program rules §19), with a reason and who made it, logged. Approving issues the Partner
 * ID and dashboard link once and keeps them after; a newly approved partner starts at Level 1. No status erases
 * commission already earned.
 */
export async function setPartnerStatus(id: number, to: PartnerStatus, reasonText: string | null, byText: string | null): Promise<string | null> {
  const by = need(byText, 'Enter your name');
  return db.transaction(async (t) => {
    const [p] = rowsOf<{ status: PartnerStatus; approved_at: Date | null }>(await t.execute(sql`SELECT status, approved_at FROM partners WHERE id = ${id} FOR UPDATE`));
    if (!p) throw new PartnerError('Unknown partner');
    if (!STATUS_MOVES[p.status].includes(to)) throw new PartnerError(`A partner who is ${PARTNER_STATUS_LABEL[p.status].toLowerCase()} cannot be made ${PARTNER_STATUS_LABEL[to].toLowerCase()}`);
    const reason = to === 'approved' && p.status === 'applied' ? (reasonText?.trim() || 'Application approved') : need(reasonText, 'Give the reason');
    let code: string | null = null;
    if (to === 'approved') {
      [{ partner_code: code }] = rowsOf<{ partner_code: string }>(await t.execute(sql`
        UPDATE partners SET status = 'approved', status_note = ${reason},
          partner_code = CASE WHEN partner_code IS NULL THEN 'APR-' || lpad(nextval('partner_code_seq')::text, 5, '0') ELSE partner_code END,
          dashboard_token = COALESCE(dashboard_token, ${newToken()}),
          level = CASE WHEN approved_at IS NULL THEN 1 ELSE level END, below_streak = CASE WHEN approved_at IS NULL THEN 0 ELSE below_streak END,
          approved_at = COALESCE(approved_at, now()), decided_at = now(), updated_at = now()
        WHERE id = ${id} RETURNING partner_code`));
    } else {
      await t.execute(sql`UPDATE partners SET status = ${to}, status_note = ${reason}, decided_at = now(), updated_at = now() WHERE id = ${id}`);
    }
    await t.execute(sql`INSERT INTO partner_status_log (partner_id, from_status, to_status, reason, changed_by) VALUES (${id}, ${p.status}, ${to}, ${reason}, ${by})`);
    return code;
  });
}

/** A manual partnership level change (an exception to the month-end review), with a reason and who made it. */
export async function setPartnerLevel(id: number, levelValue: unknown, reasonText: string | null, byText: string | null) {
  const lv = level(levelValue), reason = need(reasonText, 'Give the reason for changing the level'), by = need(byText, 'Enter your name');
  await db.transaction(async (t) => {
    const [p] = rowsOf<{ level: number }>(await t.execute(sql`SELECT level FROM partners WHERE id = ${id} FOR UPDATE`));
    if (!p) throw new PartnerError('Unknown partner');
    if (p.level === lv) throw new PartnerError('That is already their level');
    await t.execute(sql`UPDATE partners SET level = ${lv}, below_streak = 0, updated_at = now() WHERE id = ${id}`);
    await t.execute(sql`
      INSERT INTO partner_level_reviews (partner_id, kind, previous_level, new_level, effective_month, note, changed_by)
      VALUES (${id}, 'manual', ${p.level}, ${lv}, partner_this_month(), ${reason}, ${by})`);
  });
}

export type PartnerDetailsInput = { fullName: string; email: string; city: string; category: string; notes: string | null };
export async function updatePartnerDetails(id: number, d: PartnerDetailsInput) {
  await db.execute(sql`
    UPDATE partners SET full_name = ${d.fullName}, email = ${d.email}, city = ${d.city}, category = ${d.category}, notes = ${d.notes}, updated_at = now()
    WHERE id = ${id}`);
}

/** `received`: document keys ticked on the form. A newly ticked one is dated today; an unticked one is removed. */
export async function savePartnerDocuments(id: number, received: string[]) {
  const [row] = rowsOf<{ documents: Record<string, string> }>(await db.execute(sql`SELECT documents FROM partners WHERE id = ${id}`));
  if (!row) throw new PartnerError('Unknown partner');
  const today = todayIst();
  const next: Record<string, string> = {};
  for (const d of PARTNER_DOCUMENTS) if (received.includes(d.key)) next[d.key] = row.documents[d.key] ?? today;
  await db.execute(sql`UPDATE partners SET documents = ${JSON.stringify(next)}::jsonb, updated_at = now() WHERE id = ${id}`);
}

/** A new private dashboard link; the old one stops working. */
export async function rotateDashboardLink(id: number) {
  await db.execute(sql`UPDATE partners SET dashboard_token = ${newToken()}, updated_at = now() WHERE id = ${id} AND dashboard_token IS NOT NULL`);
}

// ── Commissions and payouts ───────────────────────────────────────────────────

/**
 * Validates pending commissions: staff have checked each bill against the POS. Its amount follows its month: the
 * month's commission level rate on the bill's net value (partner_refresh_months), recalculated until paid. A bill of an
 * existing customer's referral waits until the referral is verified. Returns how many were validated and how many left.
 */
export async function validateCommissions(ids: number[]): Promise<{ validated: number; unverified: number }> {
  if (!ids.length) return { validated: 0, unverified: 0 };
  const done = rowsOf(await db.execute(sql`
    UPDATE partner_commissions pc SET status = 'validated', payout_month = partner_month_of(pc.billed_at),
      net_amount = coalesce(pc.net_amount, pc.bill_amount), commission_percent = 0, commission_amount = 0, validated_at = now(), note = NULL
    FROM partner_referrals r
    WHERE pc.id IN ${ids} AND r.id = pc.referral_id AND pc.status = 'pending' AND r.verify_status IS DISTINCT FROM 'pending'
    RETURNING pc.id`));
  const [{ n }] = rowsOf<{ n: string }>(await db.execute(sql`SELECT count(*) AS n FROM partner_commissions WHERE id IN ${ids} AND status = 'pending'`));
  await refreshReferrals();
  return { validated: done.length, unverified: Number(n) };
}

export async function rejectCommission(id: number, note: string) {
  if (!note) throw new PartnerError('Say why the commission is rejected');
  const done = rowsOf(await db.execute(sql`
    UPDATE partner_commissions SET status = 'rejected', note = ${note}, commission_amount = NULL, commission_percent = NULL,
      level = NULL, payout_month = NULL, validated_at = now()
    WHERE id = ${id} AND status IN ('pending', 'validated') RETURNING id`));
  if (!done.length) throw new PartnerError('A paid commission cannot be rejected');
  await refreshReferrals();
}

/** Back to "to validate", e.g. a validation or rejection made by mistake. Not for a paid commission. */
export async function reopenCommission(id: number) {
  await db.execute(sql`
    UPDATE partner_commissions SET status = 'pending', note = NULL, commission_amount = NULL, commission_percent = NULL,
      level = NULL, payout_month = NULL, validated_at = NULL
    WHERE id = ${id} AND status IN ('validated', 'rejected')`);
  await refreshReferrals();
}

/**
 * Marks a partner's month paid: its validated commission lines and the month's bonus, with the payment reference. Only
 * once the month has ended, and not while the partner is on hold. The month's numbers are then fixed.
 */
export async function markPaid(partnerId: number, month: string, reference: string): Promise<number> {
  if (!reference) throw new PartnerError('Enter the payment reference (UTR, cheque or voucher number)');
  return db.transaction(async (t) => {
    const [p] = rowsOf<{ status: PartnerStatus; this_month: string }>(await t.execute(sql`SELECT status, partner_this_month() AS this_month FROM partners WHERE id = ${partnerId} FOR UPDATE`));
    if (!p) throw new PartnerError('Unknown partner');
    if (p.status === 'on_hold') throw new PartnerError('This partner is on hold: payouts are stopped until the review ends');
    if (month >= p.this_month) throw new PartnerError('A month is paid after it ends, once its sales are final');
    const lines = rowsOf(await t.execute(sql`
      UPDATE partner_commissions SET status = 'paid', paid_at = now(), payout_reference = ${reference}
      WHERE partner_id = ${partnerId} AND payout_month = ${month} AND status = 'validated' RETURNING id`)).length;
    await t.execute(sql`UPDATE partner_months SET paid_at = now(), payout_reference = ${reference} WHERE partner_id = ${partnerId} AND month = ${month} AND paid_at IS NULL`);
    return lines;
  });
}

// ── Existing-customer referrals ───────────────────────────────────────────────

/** Staff confirm the partner brought an existing customer in: the referral's bills can now earn. */
export async function verifyReferral(id: number, byText: string | null, note: string | null) {
  const by = need(byText, 'Enter your name');
  const done = rowsOf(await db.execute(sql`
    UPDATE partner_referrals SET verify_status = 'verified', verified_by = ${by}, verified_at = now(), verify_note = ${note}, updated_at = now()
    WHERE id = ${id} AND verify_status = 'pending' RETURNING id`));
  if (!done.length) throw new PartnerError('This referral is not waiting for verification');
  await refreshReferrals();
}

/** Staff find the partner had no part in an existing customer's purchase: the referral is declined and never earns. */
export async function declineExistingReferral(id: number, byText: string | null, note: string | null) {
  const by = need(byText, 'Enter your name'), reason = need(note, 'Say why it is not accepted');
  await db.transaction(async (t) => {
    const done = rowsOf(await t.execute(sql`
      UPDATE partner_referrals SET status = 'declined', decline_reason = 'recent_purchase', verify_status = NULL,
        verified_by = ${by}, verified_at = now(), verify_note = ${reason}, updated_at = now()
      WHERE id = ${id} AND verify_status = 'pending' RETURNING id`));
    if (!done.length) throw new PartnerError('This referral is not waiting for verification');
    await t.execute(sql`DELETE FROM partner_commissions WHERE referral_id = ${id} AND status = 'pending'`);
  });
  await refreshReferrals();
}

