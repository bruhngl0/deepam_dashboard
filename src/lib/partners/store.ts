/**
 * Ananta Partner writes: applications, referral registrations, partner decisions, documents, commission validation
 * and payouts. The referral rules themselves are SQL (drizzle/0039: partner_referral_block, partner_refresh_referrals)
 * so a page load, a registration and a test all apply the same ones.
 */

import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { upsertLeadByPhone } from '@/lib/marketing/store';
import { LEVELS, PARTNER_CODE, PARTNER_DOCUMENTS, REFERRAL_STORES, type DeclineReason } from './constants';
import { isBot, parseApplication, parseReferral, type Read } from './forms';
import { withPartnerReferral } from './lead';

export const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const newToken = () => randomBytes(24).toString('base64url');

export class PartnerError extends Error {}

/** Matches new bills to referrals and updates referral statuses (idempotent). */
export async function refreshReferrals(): Promise<void> {
  await db.execute(sql`SELECT partner_refresh_referrals()`);
}

// ── Public forms ──────────────────────────────────────────────────────────────

export type ApplyResult = { kind: 'saved' | 'existing' } | { kind: 'invalid'; message: string };

/** Saves a partner application. A phone that already applied is not saved again. */
export async function applyAsPartner(read: Read): Promise<ApplyResult> {
  if (isBot(read)) return { kind: 'saved' };
  const parsed = parseApplication(read);
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
  const upper = code.trim().toUpperCase();
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
 * Registers a customer on a partner's referral link. The number is checked against the CRM first: a customer with a
 * bill in the look-back years, a number another partner already registered (window still open), the partner's own
 * number or a store/staff number is not accepted. The attempt is still kept, as declined, for disputes. An accepted
 * registration opens a Marketing Intelligence follow-up to confirm the appointment.
 */
export async function registerReferral(partnerCode: string, read: Read): Promise<ReferResult> {
  const partner = await activePartner(partnerCode);
  if (!partner) return { kind: 'inactive' };
  if (isBot(read)) return { kind: 'saved' };
  const parsed = parseReferral(read, todayIst());
  if (!parsed.ok) return { kind: 'invalid', message: parsed.message };
  const r = parsed.value;

  const reason = await db.transaction(async (t) => {
    // Two registrations of one number at the same moment must not both be accepted.
    await t.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`partner-referral:${r.phone}`}))`);
    // A referral whose window has closed must read as expired before the number is checked again.
    await t.execute(sql`SELECT partner_refresh_referrals(${r.phone})`);
    const [{ block }] = rowsOf<{ block: DeclineReason | null }>(await t.execute(sql`SELECT partner_referral_block(${r.phone}, ${partner.id}) AS block`));
    await t.execute(sql`
      INSERT INTO partner_referrals (partner_id, full_name, contact, phone_e164, customer_id, occasion, preferred_store_id,
                                     appointment_date, consent_at, status, decline_reason, registered_on, window_ends_on)
      SELECT ${partner.id}, ${r.fullName}, ${r.contact}, ${r.phone}, (SELECT id FROM customers WHERE phone_e164 = ${r.phone}),
             ${r.occasion}, (SELECT id FROM stores WHERE code = ${r.storeCode}), ${r.appointmentDate}::date, now(),
             ${block ? 'declined' : 'registered'}, ${block}, d.today, d.today + partner_setting_int('partner_purchase_window_days', 60)
      FROM (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today) d`);
    return block;
  });
  if (reason) return { kind: 'declined', reason };

  // The registration is saved; a failure here must not cost the customer their thank-you.
  const store = REFERRAL_STORES.find((s) => s.code === r.storeCode)!;
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

/** Approves an applicant (or reactivates a suspended partner): issues the Partner ID and dashboard link once, keeps them after. */
export async function approvePartner(id: number, levelValue: unknown, note: string | null) {
  const lv = level(levelValue);
  const done = rowsOf<{ partner_code: string }>(await db.execute(sql`
    UPDATE partners SET status = 'approved', level = ${lv}, status_note = ${note},
      partner_code = CASE WHEN partner_code IS NULL THEN 'DPR-' || lpad(nextval('partner_code_seq')::text, 5, '0') ELSE partner_code END,
      dashboard_token = COALESCE(dashboard_token, ${newToken()}),
      approved_at = COALESCE(approved_at, now()), decided_at = now(), updated_at = now()
    WHERE id = ${id} AND status IN ('applied', 'rejected', 'suspended') RETURNING partner_code`));
  if (!done.length) throw new PartnerError('This partner is already approved');
  return done[0].partner_code;
}

/** Rejects an application, or suspends an approved partner (their link stops accepting registrations). */
export async function setPartnerInactive(id: number, to: 'rejected' | 'suspended', note: string | null) {
  const from = to === 'rejected' ? ['applied'] : ['approved'];
  const done = rowsOf(await db.execute(sql`
    UPDATE partners SET status = ${to}, status_note = ${note}, decided_at = now(), updated_at = now()
    WHERE id = ${id} AND status IN ${from} RETURNING id`));
  if (!done.length) throw new PartnerError(to === 'rejected' ? 'Only an application awaiting a decision can be rejected' : 'Only an approved partner can be suspended');
}

export async function setPartnerLevel(id: number, levelValue: unknown) {
  await db.execute(sql`UPDATE partners SET level = ${level(levelValue)}, updated_at = now() WHERE id = ${id}`);
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
 * Validates pending commissions into `payoutMonth`'s cycle at each partner's current level rate (commission % of the
 * bill amount). Returns how many were validated and how many were left because their level has no rate yet.
 */
export async function validateCommissions(ids: number[], payoutMonth: string): Promise<{ validated: number; noRate: number }> {
  if (!ids.length) return { validated: 0, noRate: 0 };
  const done = rowsOf(await db.execute(sql`
    UPDATE partner_commissions pc SET status = 'validated', level = p.level, commission_percent = l.commission_percent,
      commission_amount = round(pc.bill_amount * l.commission_percent / 100, 2), payout_month = ${payoutMonth}, validated_at = now(), note = NULL
    FROM partners p JOIN partner_levels l ON l.level = p.level
    WHERE pc.id IN ${ids} AND pc.partner_id = p.id AND pc.status = 'pending' AND l.commission_percent IS NOT NULL
    RETURNING pc.id`));
  const [{ n }] = rowsOf<{ n: string }>(await db.execute(sql`
    SELECT count(*) AS n FROM partner_commissions WHERE id IN ${ids} AND status = 'pending'`));
  await refreshReferrals();
  return { validated: done.length, noRate: Number(n) };
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

/** Marks a partner's validated commissions for a month as paid. */
export async function markPaid(partnerId: number, month: string, reference: string): Promise<number> {
  if (!reference) throw new PartnerError('Enter the payment reference (UTR, cheque or voucher number)');
  return rowsOf(await db.execute(sql`
    UPDATE partner_commissions SET status = 'paid', paid_at = now(), payout_reference = ${reference}
    WHERE partner_id = ${partnerId} AND payout_month = ${month} AND status = 'validated' RETURNING id`)).length;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export type LevelInput = { level: number; name: string; percent: number | null; notes: string | null };

export async function saveRules(levels: LevelInput[], windowDays: number, lookbackYears: number) {
  await db.transaction(async (t) => {
    for (const l of levels) {
      await t.execute(sql`
        UPDATE partner_levels SET name = ${l.name}, commission_percent = ${l.percent}, notes = ${l.notes}, updated_at = now()
        WHERE level = ${l.level}`);
    }
    for (const [key, value] of [['partner_purchase_window_days', windowDays], ['partner_lookback_years', lookbackYears]] as const) {
      await t.execute(sql`UPDATE settings SET value = ${JSON.stringify(value)}::jsonb, updated_at = now() WHERE key = ${key}`);
    }
  });
}
