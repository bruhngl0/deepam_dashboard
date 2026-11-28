/**
 * Ananta Partner Network program rules v1.0, phases 2–4 (drizzle/0048): monthly settlement statements and payments,
 * attribution claims, fraud flags and retrospective attribution, campaigns and exclusions, influencer collaborations,
 * additional incentives and personal shopping. The arithmetic is SQL (partner_month_calc, partner_compute_settlement);
 * this file holds the decisions people make on top of it, each with who made it and why.
 *
 * Settlement flow: pending verification (worked out live) → accounts verify (frozen: the month, its collaborations,
 * incentives and adjustments are tied to the statement) → pending approval → management approve → accounts record
 * payments (partial allowed; a reference is never used twice) → paid. A statement with nothing to pay (zero, negative
 * or below the minimum payout) stops at "verified" and its balance opens the next statement. Nothing settled is edited:
 * later returns or decisions become adjustments on the next statement.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { PartnerError, rowsOf } from './store';
import { rulesFor, shiftMonth, thisMonthIst } from './rules';
import { normalizePartnerCode } from './constants';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const need = (v: string | null | undefined, message: string) => {
  const t = (v ?? '').trim();
  if (!t) throw new PartnerError(message);
  return t;
};
const money = (v: unknown, message: string, { allowNegative = false } = {}) => {
  const n = Number(String(v ?? '').replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(n) || n === 0 || (!allowNegative && n < 0)) throw new PartnerError(message);
  return Math.round(n * 100) / 100;
};
const isoDate = (v: string | null | undefined, message: string) => {
  const t = (v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) throw new PartnerError(message);
  return t;
};
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

// ── Settlements ───────────────────────────────────────────────────────────────

export const SETTLEMENT_STATUSES = ['pending_verification', 'verified', 'pending_approval', 'approved', 'on_hold', 'partially_paid', 'paid', 'adjusted'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_LABEL: Record<SettlementStatus, string> = {
  pending_verification: 'Pending verification',
  verified: 'Verified · carried forward',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  on_hold: 'On hold',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  adjusted: 'Adjusted',
};

async function lockSettlement(t: Tx, id: number) {
  const [s] = rowsOf<{ id: number; partner_id: number; month: string; status: SettlementStatus; net_payable: string; paid_amount: string; held_lines: number; partner_status: string; hold_from: string | null }>(
    await t.execute(sql`SELECT s.*, p.status AS partner_status FROM partner_settlements s JOIN partners p ON p.id = s.partner_id WHERE s.id = ${id} FOR UPDATE OF s`));
  if (!s) throw new PartnerError('Unknown statement');
  return s;
}

/**
 * Accounts verify a statement: worked out one last time, then frozen. Every bill of the month must be validated or
 * rejected and nothing may be on hold. With something to pay it waits for management; otherwise it is final and its
 * balance carries forward.
 */
export async function verifySettlement(id: number, byText: string | null) {
  const by = need(byText, 'Enter your name');
  return db.transaction(async (t) => {
    let s = await lockSettlement(t, id);
    if (s.status !== 'pending_verification') throw new PartnerError('This statement has already been verified');
    if (s.month >= thisMonthIst()) throw new PartnerError('A month is settled after it ends');
    await t.execute(sql`SELECT partner_compute_settlement(${id})`);
    s = await lockSettlement(t, id);
    const [{ pending }] = rowsOf<{ pending: string }>(await t.execute(sql`
      SELECT count(*) AS pending FROM partner_commissions pc JOIN partner_referrals r ON r.id = pc.referral_id
      WHERE pc.partner_id = ${s.partner_id} AND partner_month_of(pc.billed_at) = ${s.month} AND pc.status = 'pending' AND NOT pc.excluded
        AND r.verify_status IS DISTINCT FROM 'pending'`));
    if (Number(pending)) throw new PartnerError(`${pending} bill${Number(pending) === 1 ? '' : 's'} of this month still to validate or reject on Referrals`);
    if (s.held_lines) throw new PartnerError(`${s.held_lines} bill${s.held_lines === 1 ? ' is' : 's are'} on hold (a claim or a flag): resolve on Controls first`);
    const net = num(s.net_payable), minPayout = num((await rulesFor(s.month)).terms.minPayout ?? 0);
    const next: SettlementStatus = net > 0 && net >= minPayout ? 'pending_approval' : 'verified';
    await t.execute(sql`
      UPDATE partner_settlements SET status = ${next}, verified_by = ${by}, verified_at = now(), updated_at = now(),
        statement = jsonb_build_object('lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object('voucher', l.voucher_no, 'store', l.store, 'net', l.net, 'campaign', l.campaign_id, 'share', l.share) ORDER BY l.voucher_no), '[]'::jsonb)
                                                FROM partner_eligible_lines l WHERE l.partner_id = ${s.partner_id} AND l.month = ${s.month}))
      WHERE id = ${id}`);
    await t.execute(sql`UPDATE partner_months SET settled_at = now() WHERE partner_id = ${s.partner_id} AND month = ${s.month}`);
    await t.execute(sql`UPDATE partner_collaborations SET settlement_id = ${id}
      WHERE partner_id = ${s.partner_id} AND status = 'completed' AND settlement_id IS NULL AND partner_month_of(completed_at) <= ${s.month}`);
    await t.execute(sql`UPDATE partner_incentive_awards SET settlement_id = ${id} WHERE partner_id = ${s.partner_id} AND settlement_id IS NULL AND month <= ${s.month}`);
    await t.execute(sql`UPDATE partner_adjustments SET applied_settlement_id = ${id}
      WHERE partner_id = ${s.partner_id} AND applied_settlement_id IS NULL AND (kind = 'recalc' OR approved_by IS NOT NULL)`);
    return next;
  });
}

/** Management approve a verified statement for payment. Approval needs a different person from verification. */
export async function approveSettlement(id: number, byText: string | null) {
  const by = need(byText, 'Enter your name');
  await db.transaction(async (t) => {
    const s = await lockSettlement(t, id);
    if (s.status !== 'pending_approval') throw new PartnerError('Only a statement pending approval can be approved');
    const [{ verified_by }] = rowsOf<{ verified_by: string }>(await t.execute(sql`SELECT verified_by FROM partner_settlements WHERE id = ${id}`));
    if (verified_by.trim().toLowerCase() === by.toLowerCase()) throw new PartnerError('The person who verified a statement cannot also approve it');
    await t.execute(sql`UPDATE partner_settlements SET status = 'approved', approved_by = ${by}, approved_at = now(), updated_at = now() WHERE id = ${id}`);
  });
}

/** Sends a statement back to be worked out again (before approval only), e.g. a bill was validated after verification. */
export async function reopenSettlement(id: number, byText: string | null, reasonText: string | null) {
  need(byText, 'Enter your name');
  const reason = need(reasonText, 'Say why it is sent back');
  await db.transaction(async (t) => {
    const s = await lockSettlement(t, id);
    if (!['pending_approval', 'verified'].includes(s.status)) throw new PartnerError('Only a verified statement that is not yet approved or paid can be sent back');
    const [later] = rowsOf(await t.execute(sql`SELECT 1 FROM partner_settlements WHERE partner_id = ${s.partner_id} AND month > ${s.month} AND status <> 'pending_verification'`));
    if (later) throw new PartnerError('A later statement has been verified: correct this one with an adjustment instead');
    await t.execute(sql`UPDATE partner_months SET settled_at = NULL WHERE partner_id = ${s.partner_id} AND month = ${s.month}`);
    await t.execute(sql`UPDATE partner_collaborations SET settlement_id = NULL WHERE settlement_id = ${id}`);
    await t.execute(sql`UPDATE partner_incentive_awards SET settlement_id = NULL WHERE settlement_id = ${id}`);
    await t.execute(sql`UPDATE partner_adjustments SET applied_settlement_id = NULL WHERE applied_settlement_id = ${id}`);
    await t.execute(sql`UPDATE partner_settlements SET status = 'pending_verification', verified_by = NULL, verified_at = NULL, statement = NULL,
      hold_reason = ${`Sent back: ${reason}`}, updated_at = now() WHERE id = ${id}`);
    await t.execute(sql`SELECT partner_compute_settlement(${id})`);
  });
}

export async function holdSettlement(id: number, byText: string | null, reasonText: string | null) {
  const by = need(byText, 'Enter your name'), reason = need(reasonText, 'Give the reason for the hold');
  await db.transaction(async (t) => {
    const s = await lockSettlement(t, id);
    if (!['pending_approval', 'approved', 'partially_paid'].includes(s.status)) throw new PartnerError('Only a verified statement waiting for approval or payment can be put on hold');
    await t.execute(sql`UPDATE partner_settlements SET hold_from = status, status = 'on_hold', hold_reason = ${reason}, held_by = ${by}, updated_at = now() WHERE id = ${id}`);
  });
}

export async function releaseSettlement(id: number, byText: string | null) {
  need(byText, 'Enter your name');
  await db.transaction(async (t) => {
    const s = await lockSettlement(t, id);
    if (s.status !== 'on_hold') throw new PartnerError('This statement is not on hold');
    await t.execute(sql`UPDATE partner_settlements SET status = COALESCE(hold_from, 'pending_approval'), hold_from = NULL, updated_at = now() WHERE id = ${id}`);
  });
}

/**
 * Records a payment against an approved statement. Never more than what is outstanding, never with a reference used
 * before (the unique index catches a race), never while the partner or statement is on hold. Paid in full: the
 * statement's bills and collaborations are marked paid.
 */
export async function recordPayment(id: number, amountValue: unknown, paidOnText: string | null, referenceText: string | null, byText: string | null) {
  const by = need(byText, 'Enter your name'), reference = need(referenceText, 'Enter the payment reference (UTR, cheque or voucher number)');
  const amount = money(amountValue, 'Enter the amount paid');
  const paidOn = isoDate(paidOnText || todayIst(), 'Enter the payment date');
  if (paidOn > todayIst()) throw new PartnerError('The payment date cannot be in the future');
  return db.transaction(async (t) => {
    const s = await lockSettlement(t, id);
    if (s.partner_status === 'on_hold') throw new PartnerError('This partner is on hold: payouts are stopped until the review ends');
    if (!['approved', 'partially_paid'].includes(s.status)) throw new PartnerError(s.status === 'paid' ? 'This statement is already paid in full' : 'Only an approved statement can be paid');
    const outstanding = Math.round((num(s.net_payable) - num(s.paid_amount)) * 100) / 100;
    if (amount > outstanding + 0.001) throw new PartnerError(`That is more than the ₹${outstanding.toLocaleString('en-IN')} outstanding`);
    const key = reference.replace(/\s/g, '').toUpperCase();
    const [used] = rowsOf(await t.execute(sql`SELECT 1 FROM partner_settlement_payments WHERE upper(regexp_replace(reference, '\s', '', 'g')) = ${key}`));
    if (used) throw new PartnerError('That payment reference has already been recorded: a payment is never entered twice');
    await t.execute(sql`INSERT INTO partner_settlement_payments (settlement_id, amount, paid_on, reference, recorded_by) VALUES (${id}, ${amount}, ${paidOn}, ${reference}, ${by})`);
    const full = amount >= outstanding - 0.001;
    await t.execute(sql`UPDATE partner_settlements SET paid_amount = paid_amount + ${amount}, closing_balance = net_payable - (paid_amount + ${amount}),
      status = ${full ? 'paid' : 'partially_paid'}, updated_at = now() WHERE id = ${id}`);
    if (full) {
      await t.execute(sql`UPDATE partner_commissions SET status = 'paid', paid_at = now(), payout_reference = ${reference}
        WHERE partner_id = ${s.partner_id} AND partner_month_of(billed_at) = ${s.month} AND status = 'validated'`);
      await t.execute(sql`UPDATE partner_months SET paid_at = now(), payout_reference = ${reference} WHERE partner_id = ${s.partner_id} AND month = ${s.month} AND paid_at IS NULL`);
      await t.execute(sql`UPDATE partner_collaborations SET status = 'paid' WHERE settlement_id = ${id} AND status = 'completed'`);
    }
    return full;
  });
}

/** A manual correction (either way) with its reason; applied to the next statement once management approve it. */
export async function addAdjustment(partnerId: number, monthText: string | null, amountValue: unknown, reasonText: string | null, byText: string | null) {
  const by = need(byText, 'Enter your name'), reason = need(reasonText, 'Give the reason for the adjustment');
  const amount = money(amountValue, 'Enter the adjustment amount (negative to recover)', { allowNegative: true });
  const month = /^\d{4}-\d{2}$/.test(monthText ?? '') ? monthText! : thisMonthIst();
  await db.execute(sql`INSERT INTO partner_adjustments (partner_id, kind, month, amount, reason, created_by, rule_version_id)
    VALUES (${partnerId}, 'manual', ${month}, ${amount}, ${reason}, ${by}, (partner_rules_for(${month})).id)`);
}
export async function approveAdjustment(id: number, byText: string | null) {
  const by = need(byText, 'Enter your name');
  const done = rowsOf(await db.execute(sql`UPDATE partner_adjustments SET approved_by = ${by}
    WHERE id = ${id} AND kind = 'manual' AND approved_by IS NULL AND lower(created_by) <> lower(${by}) RETURNING id`));
  if (!done.length) throw new PartnerError('Not approved: it is already approved, or you entered it yourself (someone else approves)');
}

// ── Attribution: claims and retrospective ─────────────────────────────────────

export const CLAIMANT_LABEL = { partner: 'Another partner', driver: 'Driver', travel_agent: 'Travel agent', affiliate: 'Affiliate', other: 'Other' } as const;
export type ClaimantType = keyof typeof CLAIMANT_LABEL;

/** Another party claims a bill: the partner's line goes on hold until management decide. */
export async function addClaim(voucherText: string | null, type: string, nameText: string | null, note: string | null, byText: string | null) {
  const voucher = need(voucherText, 'Enter the invoice number').toUpperCase(), name = need(nameText, 'Enter who is claiming it'), by = need(byText, 'Enter your name');
  if (!(type in CLAIMANT_LABEL)) throw new PartnerError('Choose who is claiming');
  const [sale] = rowsOf(await db.execute(sql`SELECT 1 FROM sales WHERE upper(voucher_no) = ${voucher}`));
  if (!sale) throw new PartnerError('No bill with that invoice number');
  const [open] = rowsOf(await db.execute(sql`SELECT 1 FROM partner_claims WHERE upper(voucher_no) = ${voucher} AND status = 'open'`));
  if (open) throw new PartnerError('That bill already has an open claim');
  await db.execute(sql`INSERT INTO partner_claims (voucher_no, claimant_type, claimant_name, note, created_by)
    VALUES ((SELECT voucher_no FROM sales WHERE upper(voucher_no) = ${voucher}), ${type}, ${name}, ${note}, ${by})`);
}

/**
 * One beneficiary per bill, unless management share it: `partner` (the partner keeps it), `other` (the other party
 * gets it; the partner's line earns nothing) or `shared` (the partner's percentage of the commission).
 */
export async function resolveClaim(id: number, resolution: string, sharePercent: unknown, reasonText: string | null, byText: string | null) {
  const by = need(byText, 'Enter your name'), reason = need(reasonText, 'Give the reason for the decision');
  if (!['partner', 'other', 'shared'].includes(resolution)) throw new PartnerError('Choose the decision');
  let share: number | null = null;
  if (resolution === 'shared') {
    share = Number(sharePercent);
    if (!Number.isFinite(share) || share <= 0 || share >= 100) throw new PartnerError('A shared bill gives the partner between 1% and 99% of its commission');
  }
  const done = rowsOf(await db.execute(sql`UPDATE partner_claims SET status = 'resolved', resolution = ${resolution}, partner_share_percent = ${share},
      resolved_by = ${by}, resolved_reason = ${reason}, resolved_at = now() WHERE id = ${id} AND status = 'open' RETURNING id`));
  if (!done.length) throw new PartnerError('This claim has already been decided');
}

/**
 * A bill the matching did not attach (outside the window, or before the referral was entered) attached to a
 * referral after the fact: requested with a reason, then approved by a different person. Never for a bill already
 * attributed to someone.
 */
export async function requestRetro(voucherText: string | null, partnerCode: string | null, reasonText: string | null, byText: string | null) {
  const voucher = need(voucherText, 'Enter the invoice number').toUpperCase(), reason = need(reasonText, 'Give the reason'), by = need(byText, 'Enter your name');
  const code = normalizePartnerCode(need(partnerCode, 'Enter the Partner ID'));
  await db.transaction(async (t) => {
    const [s] = rowsOf<{ voucher_no: string; store_id: number; billed_at: Date; bill_amount: string; phone: string | null }>(await t.execute(sql`
      SELECT s.voucher_no, s.store_id, s.billed_at, s.bill_amount, c.phone_e164 AS phone FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE upper(s.voucher_no) = ${voucher}`));
    if (!s) throw new PartnerError('No bill with that invoice number');
    const [taken] = rowsOf(await t.execute(sql`SELECT 1 FROM partner_commissions WHERE voucher_no = ${s.voucher_no}`));
    if (taken) throw new PartnerError('That bill is already attributed to a partner: one beneficiary per bill (use a claim to dispute it)');
    const [r] = rowsOf<{ id: number; partner_id: number }>(await t.execute(sql`
      SELECT r.id, r.partner_id FROM partner_referrals r JOIN partners p ON p.id = r.partner_id
      WHERE p.partner_code = ${code} AND r.phone_e164 = ${s.phone} AND r.status <> 'declined' ORDER BY r.registered_at DESC LIMIT 1`));
    if (!r) throw new PartnerError(`${code} has no referral for this bill's customer`);
    await t.execute(sql`INSERT INTO partner_commissions (referral_id, partner_id, voucher_no, store_id, billed_at, bill_amount, retro, retro_reason, retro_requested_by, on_hold)
      VALUES (${r.id}, ${r.partner_id}, ${s.voucher_no}, ${s.store_id}, ${s.billed_at}, ${s.bill_amount}, true, ${reason}, ${by}, true)`);
    await t.execute(sql`INSERT INTO partner_flags (kind, partner_id, voucher_no, detail, created_by)
      VALUES ('retro_attribution', ${r.partner_id}, ${s.voucher_no}, ${`Retrospective attribution requested: ${reason}`}, ${by}) ON CONFLICT DO NOTHING`);
  });
}

// ── Fraud flags ───────────────────────────────────────────────────────────────

export const FLAG_LABEL: Record<string, string> = {
  self_referral: 'Self referral', duplicate_registration: 'Duplicate registration', repeated_returns: 'Repeated returns', large_bill: 'Unusually large bill',
  personal_as_referral: 'Personal purchase as referral', unusual_adjustment: 'Unusual adjustment', duplicate_payout: 'Possible duplicate payout',
  retro_attribution: 'Retrospective attribution', manual: 'Raised by staff',
};

export async function raiseFlag(partnerId: number, voucher: string | null, detailText: string | null, byText: string | null) {
  const detail = need(detailText, 'Describe the concern'), by = need(byText, 'Enter your name');
  await db.execute(sql`INSERT INTO partner_flags (kind, partner_id, voucher_no, detail, created_by)
    VALUES ('manual', ${partnerId}, (SELECT voucher_no FROM sales WHERE upper(voucher_no) = upper(${voucher ?? ''})), ${detail}, ${by})`);
}

/** Cleared: the bill earns again. Confirmed: the bill never earns (for a retrospective request, cleared = approved). */
export async function resolveFlag(id: number, outcome: 'cleared' | 'confirmed', reasonText: string | null, byText: string | null) {
  const by = need(byText, 'Enter your name'), reason = need(reasonText, 'Give the reason');
  await db.transaction(async (t) => {
    const [f] = rowsOf<{ kind: string; voucher_no: string | null; created_by: string }>(await t.execute(sql`SELECT kind, voucher_no, created_by FROM partner_flags WHERE id = ${id} AND status = 'open' FOR UPDATE`));
    if (!f) throw new PartnerError('This flag has already been decided');
    if (f.kind === 'retro_attribution') {
      if (f.created_by.trim().toLowerCase() === by.toLowerCase()) throw new PartnerError('A retrospective attribution is approved by someone other than who asked for it');
      if (outcome === 'confirmed') await t.execute(sql`DELETE FROM partner_commissions WHERE voucher_no = ${f.voucher_no} AND retro AND status = 'pending'`);
      else await t.execute(sql`UPDATE partner_commissions SET retro_approved_by = ${by} WHERE voucher_no = ${f.voucher_no} AND retro`);
    }
    await t.execute(sql`UPDATE partner_flags SET status = ${outcome}, resolved_by = ${by}, resolved_reason = ${reason}, resolved_at = now() WHERE id = ${id}`);
  });
}

// ── Campaigns and exclusions ──────────────────────────────────────────────────

export type CampaignInput = {
  name: string; startsOn: string; endsOn: string; storeCodes: string[]; excludedInvoices: string[]; commissionPercent: unknown; priority: unknown;
  countsTowardLevel: boolean; bonusEligible: boolean; personalDiscountAllowed: boolean; minMarginPercent: unknown; notes: string | null; by: string | null;
};

export async function createCampaign(c: CampaignInput) {
  const by = need(c.by, 'Enter your name'), name = need(c.name, 'Name the campaign');
  const starts = isoDate(c.startsOn, 'Enter the start date'), ends = isoDate(c.endsOn, 'Enter the end date');
  if (ends < starts) throw new PartnerError('The campaign ends before it starts');
  const pct = Number(c.commissionPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new PartnerError('Enter the campaign commission % (0 to 100)');
  const priority = Number.isInteger(Number(c.priority)) && String(c.priority).trim() ? Number(c.priority) : 100;
  const margin = String(c.minMarginPercent ?? '').trim() ? Number(c.minMarginPercent) : null;
  const [{ id }] = rowsOf<{ id: number }>(await db.execute(sql`
    INSERT INTO partner_campaigns (name, starts_on, ends_on, store_codes, excluded_invoices, commission_percent, priority, counts_toward_level, bonus_eligible,
      personal_discount_allowed, min_margin_percent, notes, created_by)
    VALUES (${name}, ${starts}, ${ends}, ${sql`ARRAY[${sql.join(c.storeCodes.map((s) => sql`${s}`), sql`, `)}]::text[]`},
      ${sql`ARRAY[${sql.join(c.excludedInvoices.map((s) => sql`${s.toUpperCase()}`), sql`, `)}]::text[]`}, ${pct}, ${priority}, ${c.countsTowardLevel}, ${c.bonusEligible},
      ${c.personalDiscountAllowed}, ${margin}, ${c.notes}, ${by}) RETURNING id`));
  return id;
}

/** Draft → active needs a second person. Bills of months already settled are never moved onto a campaign. */
export async function setCampaignStatus(id: number, to: 'active' | 'ended', byText: string | null) {
  const by = need(byText, 'Enter your name');
  const done = to === 'active'
    ? rowsOf(await db.execute(sql`UPDATE partner_campaigns SET status = 'active', approved_by = ${by}, approved_at = now()
        WHERE id = ${id} AND status = 'draft' AND lower(created_by) <> lower(${by}) RETURNING id`))
    : rowsOf(await db.execute(sql`UPDATE partner_campaigns SET status = 'ended' WHERE id = ${id} AND status <> 'ended' RETURNING id`));
  if (!done.length) throw new PartnerError(to === 'active' ? 'Not activated: it is not a draft, or you created it (someone else approves)' : 'Already ended');
}

export async function addExclusion(scope: string, valueText: string | null, fromText: string | null, toText: string | null, reasonText: string | null, byText: string | null) {
  const by = need(byText, 'Enter your name'), reason = need(reasonText, 'Give the reason'), value = need(valueText, 'Enter what is excluded');
  if (scope !== 'store' && scope !== 'invoice') throw new PartnerError('Choose store or invoice');
  const from = isoDate(fromText, 'Enter the date it starts'), to = toText?.trim() ? isoDate(toText, 'Enter a valid end date') : null;
  await db.execute(sql`INSERT INTO partner_exclusions (scope, value, from_on, to_on, reason, created_by) VALUES (${scope}, ${scope === 'invoice' ? value.toUpperCase() : value}, ${from}, ${to}, ${reason}, ${by})`);
}
export async function endExclusion(id: number) {
  await db.execute(sql`UPDATE partner_exclusions SET to_on = LEAST(COALESCE(to_on, 'infinity'::date), (now() AT TIME ZONE 'Asia/Kolkata')::date - 1) WHERE id = ${id}`);
}

// ── Influencer collaborations ─────────────────────────────────────────────────

/** The standard limit for approvals this month: the influencer limit of the previous completed month's commission level. */
export async function collaborationLimit(partnerId: number, month = thisMonthIst()) {
  const prev = shiftMonth(month, -1);
  const [m] = rowsOf<{ commission_level: number | null }>(await db.execute(sql`SELECT commission_level FROM partner_months WHERE partner_id = ${partnerId} AND month = ${prev}`));
  const rules = await rulesFor(prev);
  const lv = rules.levels.find((l) => l.level === (m?.commission_level ?? 1)) ?? rules.levels[0];
  const [{ used }] = rowsOf<{ used: string }>(await db.execute(sql`SELECT COALESCE(sum(amount), 0) AS used FROM partner_collaborations
    WHERE partner_id = ${partnerId} AND approval_month = ${month} AND status IN ('approved', 'completed', 'paid')`));
  return { month, level: lv.level, limit: lv.influencerLimit, used: num(used), left: Math.max(0, lv.influencerLimit - num(used)) };
}

export async function requestCollaboration(partnerId: number, d: { entity: string | null; title: string | null; deliverables: string | null; dueOn: string | null; amount: unknown; by: string | null }) {
  const by = need(d.by, 'Enter your name');
  await db.execute(sql`INSERT INTO partner_collaborations (partner_id, entity, title, deliverables, due_on, amount, requested_by)
    VALUES (${partnerId}, ${need(d.entity, 'Choose the brand approving it')}, ${need(d.title, 'Name the collaboration')}, ${need(d.deliverables, 'List the deliverables')},
      ${isoDate(d.dueOn, 'Enter the due date')}, ${money(d.amount, 'Enter the agreed fee')}, ${by})`);
}

/** Management approve within the month's limit; above it only with an exception reason. Honoured once approved. */
export async function decideCollaboration(id: number, decision: 'approve' | 'reject', reasonText: string | null, byText: string | null) {
  const by = need(byText, 'Enter your name');
  await db.transaction(async (t) => {
    const [c] = rowsOf<{ partner_id: number; amount: string; status: string; requested_by: string; partner_status: string }>(await t.execute(sql`
      SELECT c.*, p.status AS partner_status FROM partner_collaborations c JOIN partners p ON p.id = c.partner_id WHERE c.id = ${id} FOR UPDATE OF c`));
    if (!c || c.status !== 'pending') throw new PartnerError('This collaboration is not waiting for a decision');
    if (decision === 'reject') {
      await t.execute(sql`UPDATE partner_collaborations SET status = 'rejected', rejected_reason = ${need(reasonText, 'Give the reason')}, approved_by = ${by}, approved_at = now() WHERE id = ${id}`);
      return;
    }
    if (c.partner_status !== 'approved') throw new PartnerError('Only an active partner can be approved for a collaboration');
    const lim = await collaborationLimit(c.partner_id);
    const over = num(c.amount) > lim.left + 0.001;
    if (over && !reasonText?.trim()) throw new PartnerError(`This takes the month over the Level ${lim.level} limit (₹${lim.left.toLocaleString('en-IN')} left of ₹${lim.limit.toLocaleString('en-IN')}): give the reason for the exception`);
    await t.execute(sql`UPDATE partner_collaborations SET status = 'approved', approval_month = ${lim.month}, limit_at_approval = ${lim.limit},
      exception_reason = ${over ? reasonText!.trim() : null}, approved_by = ${by}, approved_at = now() WHERE id = ${id}`);
  });
}

export async function completeCollaboration(id: number, byText: string | null) {
  const by = need(byText, 'Enter your name');
  const done = rowsOf(await db.execute(sql`UPDATE partner_collaborations SET status = 'completed', completed_by = ${by}, completed_at = now() WHERE id = ${id} AND status = 'approved' RETURNING id`));
  if (!done.length) throw new PartnerError('Only an approved collaboration can be marked completed');
}

// ── Additional incentives ─────────────────────────────────────────────────────

export const INCENTIVE_KIND_LABEL = {
  first_sale: 'First sale', monthly_sales: 'Monthly sales target', consistency: 'Consistency (months in a row)', manual: 'Awarded by staff',
} as const;

export async function createIncentive(d: { name: string | null; kind: string; minSales: unknown; months: unknown; categories: string[]; levels: number[];
  startsOn: string | null; endsOn: string | null; reward: unknown; maxPayout: unknown; entity: string | null; notes: string | null; by: string | null }) {
  const by = need(d.by, 'Enter your name');
  if (!(d.kind in INCENTIVE_KIND_LABEL)) throw new PartnerError('Choose the kind of incentive');
  const starts = isoDate(d.startsOn, 'Enter the start date'), ends = isoDate(d.endsOn, 'Enter the end date');
  if (ends < starts) throw new PartnerError('It ends before it starts');
  const months = Number(d.months) || 1;
  if (months < 1 || months > 12) throw new PartnerError('Months in a row: 1 to 12');
  const max = String(d.maxPayout ?? '').trim() ? money(d.maxPayout, 'Enter a valid total cap') : null;
  await db.execute(sql`INSERT INTO partner_incentives (name, kind, min_sales, months, categories, levels, starts_on, ends_on, reward, max_payout, entity, notes, created_by)
    VALUES (${need(d.name, 'Name the incentive')}, ${d.kind}, ${Number(d.minSales) || 0}, ${months},
      ${sql`ARRAY[${sql.join(d.categories.map((s) => sql`${s}`), sql`, `)}]::text[]`}, ${sql`ARRAY[${sql.join(d.levels.map((n) => sql`${n}`), sql`, `)}]::int[]`},
      ${starts}, ${ends}, ${money(d.reward, 'Enter the reward')}, ${max}, ${d.entity}, ${d.notes}, ${by})`);
}

/** Incentives stay off until a second person activates them. */
export async function setIncentiveStatus(id: number, to: 'active' | 'ended', byText: string | null) {
  const by = need(byText, 'Enter your name');
  const done = to === 'active'
    ? rowsOf(await db.execute(sql`UPDATE partner_incentives SET status = 'active', approved_by = ${by}, approved_at = now() WHERE id = ${id} AND status = 'draft' AND lower(created_by) <> lower(${by}) RETURNING id`))
    : rowsOf(await db.execute(sql`UPDATE partner_incentives SET status = 'ended' WHERE id = ${id} AND status <> 'ended' RETURNING id`));
  if (!done.length) throw new PartnerError(to === 'active' ? 'Not activated: it is not a draft, or you created it (someone else approves)' : 'Already ended');
}

export async function awardIncentive(incentiveId: number, partnerId: number, monthText: string | null, note: string | null, byText: string | null) {
  const by = need(byText, 'Enter your name');
  const month = /^\d{4}-\d{2}$/.test(monthText ?? '') ? monthText! : shiftMonth(thisMonthIst(), -1);
  const [i] = rowsOf<{ reward: string; max_payout: string | null; given: string; status: string }>(await db.execute(sql`
    SELECT i.reward, i.max_payout, i.status, (SELECT COALESCE(sum(amount), 0) FROM partner_incentive_awards WHERE incentive_id = i.id) AS given FROM partner_incentives i WHERE i.id = ${incentiveId}`));
  if (!i || i.status !== 'active') throw new PartnerError('Only an active incentive can be awarded');
  if (i.max_payout && num(i.given) + num(i.reward) > num(i.max_payout)) throw new PartnerError('This incentive has reached its total cap');
  const done = rowsOf(await db.execute(sql`INSERT INTO partner_incentive_awards (incentive_id, partner_id, month, amount, auto, note, awarded_by)
    VALUES (${incentiveId}, ${partnerId}, ${month}, ${i.reward}, false, ${note}, ${by}) ON CONFLICT DO NOTHING RETURNING id`));
  if (!done.length) throw new PartnerError('Already awarded for that month');
}

// ── Personal shopping ─────────────────────────────────────────────────────────

/** This calendar year's personal shopping: limit, used (net of returns) and left. */
export async function shoppingAllowance(partnerId: number, year = Number(todayIst().slice(0, 4))) {
  const rules = await rulesFor();
  const limit = rules.terms.annualShoppingLimit;
  const [{ used }] = rowsOf<{ used: string }>(await db.execute(sql`
    SELECT COALESCE(sum(LEAST(pp.eligible_value, GREATEST(0, pp.eligible_value - COALESCE(s.returned_value, 0)))), 0) AS used
    FROM partner_personal_purchases pp
    LEFT JOIN LATERAL (SELECT CASE WHEN x.fully_returned THEN pp.eligible_value ELSE COALESCE(x.returned_amount, 0) * pp.purchase_value / NULLIF(x.bill_amount, 0) END AS returned_value
                       FROM sales x WHERE x.voucher_no = pp.voucher_no) s ON true
    WHERE pp.partner_id = ${partnerId} AND pp.year = ${year}`));
  return { year, limit, used: num(used), left: Math.max(0, limit - num(used)) };
}

/**
 * Records a partner's own purchase (billed in the ERP): the discount at their current level applies only to the part
 * within the annual limit. OTP at billing is required by the rules; staff confirm it was done.
 */
export async function recordPersonalPurchase(partnerId: number, d: { voucher: string | null; purchaseOn: string | null; value: unknown; otp: boolean; note: string | null; by: string | null }) {
  const by = need(d.by, 'Enter your name'), voucher = need(d.voucher, 'Enter the invoice number').toUpperCase();
  if (!d.otp) throw new PartnerError('OTP verification at billing is required for personal shopping');
  const on = isoDate(d.purchaseOn || todayIst(), 'Enter the purchase date'), value = money(d.value, 'Enter the purchase value before discount, excluding GST');
  return db.transaction(async (t) => {
    await t.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`partner-shopping:${partnerId}`}))`);
    const [p] = rowsOf<{ status: string; level: number }>(await t.execute(sql`SELECT status, level FROM partners WHERE id = ${partnerId}`));
    if (!p || p.status !== 'approved') throw new PartnerError('Only an active partner has personal shopping privileges');
    const [dup] = rowsOf(await t.execute(sql`SELECT 1 FROM partner_personal_purchases WHERE upper(voucher_no) = ${voucher}`));
    if (dup) throw new PartnerError('That invoice is already recorded as a personal purchase');
    const allowance = await shoppingAllowance(partnerId, Number(on.slice(0, 4)));
    if (allowance.left <= 0) throw new PartnerError(`The ₹${allowance.limit.toLocaleString('en-IN')} annual personal shopping limit for ${allowance.year} is used up`);
    const lv = (await rulesFor(on.slice(0, 7))).levels.find((l) => l.level === p.level)!;
    const eligible = Math.min(value, allowance.left), discount = Math.round(eligible * lv.personalDiscount) / 100;
    await t.execute(sql`INSERT INTO partner_personal_purchases (partner_id, voucher_no, purchase_on, year, purchase_value, partnership_level, discount_percent, eligible_value, discount_amount, otp_verified, note, recorded_by)
      VALUES (${partnerId}, ${voucher}, ${on}, ${Number(on.slice(0, 4))}, ${value}, ${p.level}, ${lv.personalDiscount}, ${eligible}, ${discount}, true, ${d.note}, ${by})`);
    return { eligible, discount, percent: lv.personalDiscount, left: allowance.left - eligible };
  });
}

// ── Entities ──────────────────────────────────────────────────────────────────

export async function entities() {
  return rowsOf<{ store_code: string; entity: string }>(await db.execute(sql`SELECT store_code, entity FROM partner_entities ORDER BY store_code`));
}
export async function setEntity(storeCode: string, entityText: string | null) {
  const entity = need(entityText, 'Enter the entity name');
  await db.execute(sql`INSERT INTO partner_entities (store_code, entity) VALUES (${storeCode}, ${entity}) ON CONFLICT (store_code) DO UPDATE SET entity = EXCLUDED.entity, updated_at = now()`);
}
