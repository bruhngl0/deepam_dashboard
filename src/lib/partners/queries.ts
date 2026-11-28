/** Ananta Partner Network reads for the module pages and the partner dashboard. Call `refreshReferrals()` first on a page. */

import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { ISSUED_STATUSES, normalizePartnerCode, PARTNER_CODE, REQUIRED_DOCUMENTS, type CommissionStatus, type DeclineReason, type PartnerStatus, type ReferralStatus } from './constants';
import { levelFor, rulesFor, shiftMonth, thisMonthIst, type RuleLevel } from './rules';
import { rowsOf } from './store';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

/** The module filter strip's period and stores (lib/module-filters.ts): IST dates, stores.code values comma-joined. */
export type Scope = { from?: string | null; to?: string | null; stores?: string | null };
const istDay = (col: SQL) => sql`(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
function scoped(f: Scope, dateCol: SQL, storeIdCol: SQL): SQL[] {
  const out: SQL[] = [];
  if (f.from) out.push(sql`${istDay(dateCol)} >= ${f.from}::date`);
  if (f.to) out.push(sql`${istDay(dateCol)} <= ${f.to}::date`);
  if (f.stores) out.push(sql`${storeIdCol} IN (SELECT id FROM stores WHERE code = ANY(string_to_array(${f.stores}, ',')))`);
  return out;
}
/** Referrals in scope: registered in the period, preferred store picked (or a bill at it). */
const referralScope = (f: Scope, r = sql.raw('r')) => [
  ...scoped({ from: f.from, to: f.to }, sql`${r}.registered_at`, sql`0`),
  ...(f.stores ? [sql`(${sql.join(scoped({ stores: f.stores }, sql``, sql`${r}.preferred_store_id`), sql``)} OR EXISTS (SELECT 1 FROM partner_commissions x WHERE x.referral_id = ${r}.id AND ${sql.join(scoped({ stores: f.stores }, sql``, sql`x.store_id`), sql``)}))`] : []),
];
/** Commission lines in scope: billed in the period, at a picked store. */
const commissionScope = (f: Scope, pc = sql.raw('pc')) => scoped(f, sql`${pc}.billed_at`, sql`${pc}.store_id`);
const where_ = (conds: SQL[]) => (conds.length ? sql.join(conds, sql` AND `) : sql`true`);

// ── Rules ─────────────────────────────────────────────────────────────────────

/** The referral validity in force (lib/partners/rules.ts has the full rules). */
export async function referralDays(): Promise<number> {
  return (await rulesFor()).terms.referralDays;
}

// ── Partners ──────────────────────────────────────────────────────────────────

export type Partner = {
  id: number; code: string | null; fullName: string; contact: string; phone: string; email: string; category: string; city: string;
  status: PartnerStatus; statusNote: string | null; level: number; levelName: string; belowStreak: number;
  documents: Record<string, string>; documentsComplete: boolean; dashboardToken: string | null; notes: string | null;
  appliedAt: string; approvedAt: string | null; decidedAt: string | null;
  referrals: number; registered: number; converted: number; declined: number; salesValue: number;
  commissionPending: number; commissionValidated: number; commissionPaid: number; billsToValidate: number; toVerify: number;
};

const PARTNER_SELECT = sql`
  SELECT p.*, l.name AS level_name,
    coalesce(r.total, 0) AS referrals, coalesce(r.registered, 0) AS registered, coalesce(r.converted, 0) AS converted, coalesce(r.declined, 0) AS declined,
    coalesce(c.sales_value, 0) AS sales_value, coalesce(c.pending_bills, 0) AS pending_bills,
    coalesce(c.pending_estimate, 0) AS pending_estimate, coalesce(c.validated, 0) AS validated, coalesce(c.paid, 0) AS paid
  FROM partners p
  JOIN partner_levels l ON l.level = p.level
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE status <> 'declined') AS total, count(*) FILTER (WHERE status = 'registered') AS registered,
           count(*) FILTER (WHERE status = 'converted') AS converted, count(*) FILTER (WHERE status = 'declined') AS declined,
           count(*) FILTER (WHERE verify_status = 'pending') AS to_verify
    FROM partner_referrals WHERE partner_id = p.id
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT sum(x.bill_amount) FILTER (WHERE x.status <> 'rejected') AS sales_value,
           count(*) FILTER (WHERE x.status = 'pending') AS pending_bills,
           sum(coalesce(x.net_amount, x.bill_amount) * coalesce(pm.commission_percent, 0) / 100) FILTER (WHERE x.status = 'pending') AS pending_estimate,
           sum(x.commission_amount) FILTER (WHERE x.status = 'validated') AS validated,
           sum(x.commission_amount) FILTER (WHERE x.status = 'paid') AS paid
    FROM partner_commissions x LEFT JOIN partner_months pm ON pm.partner_id = x.partner_id AND pm.month = partner_month_of(x.billed_at)
    WHERE x.partner_id = p.id
  ) c ON true`;

type PartnerRow = Record<string, unknown> & { documents: Record<string, string> };
function toPartner(r: PartnerRow): Partner {
  return {
    id: Number(r.id), code: (r.partner_code as string) ?? null, fullName: String(r.full_name), contact: String(r.contact), phone: String(r.phone_e164),
    email: String(r.email), category: String(r.category), city: String(r.city), status: r.status as PartnerStatus, statusNote: (r.status_note as string) ?? null,
    level: Number(r.level), levelName: String(r.level_name), belowStreak: num(r.below_streak),
    documents: r.documents ?? {}, documentsComplete: REQUIRED_DOCUMENTS.every((k) => !!r.documents?.[k]),
    dashboardToken: (r.dashboard_token as string) ?? null, notes: (r.notes as string) ?? null,
    appliedAt: iso(r.applied_at)!, approvedAt: iso(r.approved_at), decidedAt: iso(r.decided_at),
    referrals: num(r.referrals), registered: num(r.registered), converted: num(r.converted), declined: num(r.declined), salesValue: num(r.sales_value),
    commissionPending: num(r.pending_estimate), commissionValidated: num(r.validated), commissionPaid: num(r.paid), billsToValidate: num(r.pending_bills), toVerify: num(r.to_verify),
  };
}

export type PartnerFilters = Scope & { status?: string; category?: string; search?: string };

export async function listPartners(f: PartnerFilters = {}): Promise<Partner[]> {
  const where: SQL[] = [sql`true`];
  if (f.status) where.push(sql`p.status = ${f.status}`);
  if (f.category) where.push(sql`p.category = ${f.category}`);
  where.push(...scoped({ from: f.from, to: f.to }, sql`p.applied_at`, sql`0`));
  if (f.stores) where.push(sql`EXISTS (SELECT 1 FROM partner_referrals r WHERE r.partner_id = p.id AND ${where_(referralScope({ stores: f.stores }))})`);
  const q = f.search?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const like = `%${q.toLowerCase()}%`;
    where.push(digits.length >= 4
      ? sql`(p.phone_e164 LIKE ${`%${digits.slice(-10)}%`} OR lower(p.partner_code) LIKE ${like})`
      : sql`(lower(p.full_name) LIKE ${like} OR lower(coalesce(p.partner_code, '')) LIKE ${like} OR lower(p.email) LIKE ${like} OR lower(p.city) LIKE ${like})`);
  }
  const rows = rowsOf<PartnerRow>(await db.execute(sql`${PARTNER_SELECT} WHERE ${sql.join(where, sql` AND `)}
    ORDER BY CASE p.status WHEN 'applied' THEN 0 WHEN 'approved' THEN 1 WHEN 'on_hold' THEN 2 WHEN 'suspended' THEN 3 ELSE 4 END, p.applied_at DESC`));
  return rows.map(toPartner);
}

/** By numeric id or Partner ID (APR-00001; an old DPR-00001 still finds it). */
export async function getPartner(key: string): Promise<Partner | null> {
  const code = normalizePartnerCode(key);
  const cond = PARTNER_CODE.test(code) ? sql`p.partner_code = ${code}` : /^\d+$/.test(key) ? sql`p.id = ${Number(key)}` : null;
  if (!cond) return null;
  const [row] = rowsOf<PartnerRow>(await db.execute(sql`${PARTNER_SELECT} WHERE ${cond}`));
  return row ? toPartner(row) : null;
}

// ── Referrals ─────────────────────────────────────────────────────────────────

export type Commission = {
  id: number; voucherNo: string; storeName: string | null; billedAt: string; billAmount: number; status: CommissionStatus;
  /** Before GST, less returns: what counts towards the month. */ net: number;
  percent: number | null; amount: number | null; estimate: number | null; payoutMonth: string | null; note: string | null; paidAt: string | null; reference: string | null;
};
export type Referral = {
  id: number; partnerId: number; partnerCode: string | null; partnerName: string; fullName: string; phone: string; customerId: number | null; customerCode: string | null;
  occasion: string; storeName: string | null; appointmentDate: string | null; status: ReferralStatus; declineReason: DeclineReason | null;
  registeredAt: string; windowEndsOn: string; convertedAt: string | null; commissions: Commission[];
  /** An existing customer's referral: 'pending' until staff verify the partner's part, then 'verified'. */
  verifyStatus: 'pending' | 'verified' | null; verifiedBy: string | null; verifyNote: string | null;
};

export type ReferralFilters = Scope & { status?: string; partnerId?: number; search?: string; limit?: number; toVerify?: boolean };

export async function listReferrals(f: ReferralFilters = {}): Promise<Referral[]> {
  const where: SQL[] = [sql`true`];
  if (f.status) where.push(sql`r.status = ${f.status}`);
  if (f.partnerId) where.push(sql`r.partner_id = ${f.partnerId}`);
  if (f.toVerify) where.push(sql`r.verify_status = 'pending'`);
  where.push(...referralScope(f));
  const q = f.search?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const like = `%${q.toLowerCase()}%`;
    where.push(digits.length >= 4
      ? sql`(r.phone_e164 LIKE ${`%${digits.slice(-10)}%`} OR lower(coalesce(c.customer_code, '')) LIKE ${like} OR lower(coalesce(p.partner_code, '')) LIKE ${like})`
      : sql`(lower(r.full_name) LIKE ${like} OR lower(p.full_name) LIKE ${like} OR lower(coalesce(p.partner_code, '')) LIKE ${like} OR lower(coalesce(c.customer_code, '')) LIKE ${like})`);
  }
  const rows = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT r.*, p.partner_code, p.full_name AS partner_name, c.customer_code, COALESCE(r.preferred_store_label, st.name) AS store_name,
      coalesce((
        SELECT json_agg(json_build_object('id', pc.id, 'voucher_no', pc.voucher_no, 'store_name', cs.name, 'billed_at', pc.billed_at,
          'bill_amount', pc.bill_amount, 'net', coalesce(pc.net_amount, pc.bill_amount), 'status', pc.status, 'percent', pc.commission_percent,
          'amount', pc.commission_amount, 'month_percent', pm.commission_percent,
          'payout_month', pc.payout_month, 'note', pc.note, 'paid_at', pc.paid_at, 'reference', pc.payout_reference) ORDER BY pc.billed_at)
        FROM partner_commissions pc LEFT JOIN stores cs ON cs.id = pc.store_id
        LEFT JOIN partner_months pm ON pm.partner_id = pc.partner_id AND pm.month = partner_month_of(pc.billed_at)
        WHERE pc.referral_id = r.id
      ), '[]'::json) AS commissions
    FROM partner_referrals r
    JOIN partners p ON p.id = r.partner_id
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN stores st ON st.id = r.preferred_store_id
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY r.registered_at DESC, r.id DESC
    LIMIT ${f.limit ?? 500}`));
  return rows.map((r) => {
    return {
      id: Number(r.id), partnerId: Number(r.partner_id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.partner_name),
      fullName: String(r.full_name), phone: String(r.phone_e164), customerId: numOrNull(r.customer_id), customerCode: (r.customer_code as string) ?? null,
      occasion: String(r.occasion), storeName: (r.store_name as string) ?? null, appointmentDate: day(r.appointment_date),
      status: r.status as ReferralStatus, declineReason: (r.decline_reason as DeclineReason) ?? null,
      registeredAt: iso(r.registered_at)!, windowEndsOn: day(r.window_ends_on)!, convertedAt: iso(r.converted_at),
      verifyStatus: (r.verify_status as 'pending' | 'verified' | null) ?? null, verifiedBy: (r.verified_by as string) ?? null, verifyNote: (r.verify_note as string) ?? null,
      commissions: (r.commissions as Record<string, unknown>[]).map((c) => ({
        id: Number(c.id), voucherNo: String(c.voucher_no), storeName: (c.store_name as string) ?? null, billedAt: String(c.billed_at), billAmount: num(c.bill_amount),
        status: c.status as CommissionStatus, percent: numOrNull(c.percent), amount: numOrNull(c.amount),
        net: num(c.net),
        estimate: c.status === 'pending' && c.month_percent !== null && r.verify_status !== 'pending' ? Math.round(num(c.net) * num(c.month_percent)) / 100 : null,
        payoutMonth: (c.payout_month as string) ?? null, note: (c.note as string) ?? null, paidAt: (c.paid_at as string) ?? null, reference: (c.reference as string) ?? null,
      })),
    };
  });
}

/** Bills matched to referrals that staff have not validated or rejected yet, oldest first. */
export type PendingCommission = {
  id: number; partnerId: number; partnerCode: string | null; partnerName: string; month: string; commissionLevel: number | null; percent: number | null;
  customerName: string; customerCode: string | null; phone: string; registeredAt: string; unverified: boolean;
  voucherNo: string; storeName: string | null; billedAt: string; billAmount: number; net: number; estimate: number | null;
};

export async function pendingCommissions(f: Scope = {}): Promise<PendingCommission[]> {
  const rows = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT pc.id, pc.partner_id, p.partner_code, p.full_name AS partner_name, partner_month_of(pc.billed_at) AS month,
      pm.commission_level, pm.commission_percent, r.verify_status,
      r.full_name AS customer_name, c.customer_code, r.phone_e164, r.registered_at, pc.voucher_no, st.name AS store_name, pc.billed_at, pc.bill_amount,
      coalesce(pc.net_amount, pc.bill_amount) AS net
    FROM partner_commissions pc
    JOIN partner_referrals r ON r.id = pc.referral_id
    JOIN partners p ON p.id = pc.partner_id
    LEFT JOIN partner_months pm ON pm.partner_id = pc.partner_id AND pm.month = partner_month_of(pc.billed_at)
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN stores st ON st.id = pc.store_id
    WHERE pc.status = 'pending' AND ${where_(commissionScope(f))}
    ORDER BY pc.billed_at, pc.id`));
  return rows.map((r) => {
    const percent = numOrNull(r.commission_percent);
    return {
      id: Number(r.id), partnerId: Number(r.partner_id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.partner_name),
      month: String(r.month), commissionLevel: numOrNull(r.commission_level), percent, unverified: r.verify_status === 'pending',
      customerName: String(r.customer_name), customerCode: (r.customer_code as string) ?? null, phone: String(r.phone_e164),
      registeredAt: iso(r.registered_at)!, voucherNo: String(r.voucher_no), storeName: (r.store_name as string) ?? null,
      billedAt: iso(r.billed_at)!, billAmount: num(r.bill_amount), net: num(r.net),
      estimate: percent === null || r.verify_status === 'pending' ? null : Math.round(num(r.net) * percent) / 100,
    };
  });
}

// ── Overview ──────────────────────────────────────────────────────────────────

export type Overview = {
  applied: number; approved: number; suspended: number; rejected: number;
  referrals: number; open: number; converted: number; expired: number; declined: number; salesValue: number;
  toValidate: number; toValidateValue: number; validatedUnpaid: number; /** Paid commission on bills in scope. */ paidThisMonth: number;
  byCategory: { category: string; partners: number; referrals: number; converted: number; salesValue: number }[];
  topPartners: { id: number; code: string | null; name: string; category: string; referrals: number; converted: number; salesValue: number }[];
};

/** Partner counts are as they stand now; referrals and bills are those in scope (period and stores). */
export async function overview(f: Scope = {}): Promise<Overview> {
  const rf = sql`(SELECT r.* FROM partner_referrals r WHERE ${where_(referralScope(f))})`;
  const cm = sql`(SELECT pc.* FROM partner_commissions pc WHERE ${where_(commissionScope(f))})`;
  const [counts, categories, top] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT count(*) FROM partners WHERE status = 'applied') AS applied,
        (SELECT count(*) FROM partners WHERE status = 'approved') AS approved,
        (SELECT count(*) FROM partners WHERE status IN ('on_hold', 'suspended')) AS suspended,
        (SELECT count(*) FROM partners WHERE status = 'rejected') AS rejected,
        (SELECT count(*) FROM ${rf} r WHERE status <> 'declined') AS referrals,
        (SELECT count(*) FROM ${rf} r WHERE status = 'registered') AS open,
        (SELECT count(*) FROM ${rf} r WHERE status = 'converted') AS converted,
        (SELECT count(*) FROM ${rf} r WHERE status = 'expired') AS expired,
        (SELECT count(*) FROM ${rf} r WHERE status = 'declined') AS declined,
        (SELECT coalesce(sum(bill_amount), 0) FROM ${cm} pc WHERE status <> 'rejected') AS sales_value,
        (SELECT count(*) FROM ${cm} pc WHERE status = 'pending') AS to_validate,
        (SELECT coalesce(sum(bill_amount), 0) FROM ${cm} pc WHERE status = 'pending') AS to_validate_value,
        (SELECT coalesce(sum(commission_amount), 0) FROM ${cm} pc WHERE status = 'validated') AS validated_unpaid,
        (SELECT coalesce(sum(commission_amount), 0) FROM ${cm} pc WHERE status = 'paid') AS paid_this_month`),
    db.execute(sql`
      SELECT p.category, count(DISTINCT p.id) FILTER (WHERE p.status = 'approved') AS partners,
        (SELECT count(*) FROM ${rf} r JOIN partners p2 ON p2.id = r.partner_id WHERE p2.category = p.category AND r.status <> 'declined') AS referrals,
        (SELECT count(*) FROM ${rf} r JOIN partners p2 ON p2.id = r.partner_id WHERE p2.category = p.category AND r.status = 'converted') AS converted,
        (SELECT coalesce(sum(pc.bill_amount), 0) FROM ${cm} pc JOIN partners p2 ON p2.id = pc.partner_id WHERE p2.category = p.category AND pc.status <> 'rejected') AS sales_value
      FROM partners p GROUP BY p.category ORDER BY p.category`),
    db.execute(sql`
      SELECT p.id, p.partner_code, p.full_name, p.category,
        (SELECT count(*) FROM ${rf} r WHERE r.partner_id = p.id AND r.status <> 'declined') AS referrals,
        (SELECT count(*) FROM ${rf} r WHERE r.partner_id = p.id AND r.status = 'converted') AS converted,
        (SELECT coalesce(sum(bill_amount), 0) FROM ${cm} pc WHERE pc.partner_id = p.id AND pc.status <> 'rejected') AS sales_value
      FROM partners p WHERE p.status IN ('approved', 'on_hold', 'suspended', 'terminated')
      ORDER BY sales_value DESC, referrals DESC, p.partner_code LIMIT 10`),
  ]);
  const c = rowsOf<Record<string, unknown>>(counts)[0];
  return {
    applied: num(c.applied), approved: num(c.approved), suspended: num(c.suspended), rejected: num(c.rejected),
    referrals: num(c.referrals), open: num(c.open), converted: num(c.converted), expired: num(c.expired), declined: num(c.declined), salesValue: num(c.sales_value),
    toValidate: num(c.to_validate), toValidateValue: num(c.to_validate_value), validatedUnpaid: num(c.validated_unpaid), paidThisMonth: num(c.paid_this_month),
    byCategory: rowsOf<Record<string, unknown>>(categories).map((r) => ({ category: String(r.category), partners: num(r.partners), referrals: num(r.referrals), converted: num(r.converted), salesValue: num(r.sales_value) })),
    topPartners: rowsOf<Record<string, unknown>>(top).map((r) => ({ id: Number(r.id), code: (r.partner_code as string) ?? null, name: String(r.full_name), category: String(r.category), referrals: num(r.referrals), converted: num(r.converted), salesValue: num(r.sales_value) })),
  };
}

// ── Payouts ───────────────────────────────────────────────────────────────────

export type PayoutLine = {
  partnerId: number; partnerCode: string | null; partnerName: string; phone: string; email: string; documentsComplete: boolean;
  status: PartnerStatus; bills: number; billValue: number; eligibleSales: number; commissionLevel: number | null; commissionPercent: number | null;
  validated: number; bonus: number; bonusPaid: boolean; paid: number; paidAt: string | null; references: string[];
};

/** Per partner, the month's earnings: validated commission and the monthly bonus (to pay), and what was paid. */
export async function payouts(month: string): Promise<PayoutLine[]> {
  const rows = rowsOf<Record<string, unknown> & { documents: Record<string, string> }>(await db.execute(sql`
    SELECT p.id, p.partner_code, p.full_name, p.phone_e164, p.email, p.documents, p.status,
      max(pm.eligible_sales) AS eligible_sales, max(pm.commission_level) AS commission_level, max(pm.commission_percent) AS commission_percent,
      coalesce(max(pm.bonus), 0) AS bonus, bool_or(pm.paid_at IS NOT NULL) AS bonus_paid,
      count(*) AS bills, sum(pc.bill_amount) AS bill_value,
      coalesce(sum(pc.commission_amount) FILTER (WHERE pc.status = 'validated'), 0) AS validated,
      coalesce(sum(pc.commission_amount) FILTER (WHERE pc.status = 'paid'), 0) AS paid,
      max(pc.paid_at) AS paid_at, array_remove(array_agg(DISTINCT pc.payout_reference), NULL) AS refs
    FROM partner_commissions pc JOIN partners p ON p.id = pc.partner_id
    LEFT JOIN partner_months pm ON pm.partner_id = p.id AND pm.month = ${month}
    WHERE pc.payout_month = ${month} AND pc.status IN ('validated', 'paid')
    GROUP BY p.id ORDER BY p.partner_code`));
  return rows.map((r) => ({
    partnerId: Number(r.id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.full_name), phone: String(r.phone_e164), email: String(r.email),
    documentsComplete: REQUIRED_DOCUMENTS.every((k) => !!r.documents?.[k]), status: r.status as PartnerStatus, bills: num(r.bills), billValue: num(r.bill_value),
    eligibleSales: num(r.eligible_sales), commissionLevel: numOrNull(r.commission_level), commissionPercent: numOrNull(r.commission_percent),
    validated: num(r.validated), bonus: num(r.bonus), bonusPaid: !!r.bonus_paid, paid: num(r.paid), paidAt: iso(r.paid_at), references: (r.refs as string[]) ?? [],
  }));
}

/** Every commission line in a month's payout cycle, for the CSV. */
export async function payoutLines(month: string) {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT p.partner_code, p.full_name AS partner_name, p.category, r.full_name AS customer_name, c.customer_code,
      pc.voucher_no, st.name AS store, pc.billed_at, pc.bill_amount, pc.net_amount, pc.level, pc.commission_percent, pc.commission_amount,
      pc.status, pc.paid_at, pc.payout_reference
    FROM partner_commissions pc
    JOIN partners p ON p.id = pc.partner_id
    JOIN partner_referrals r ON r.id = pc.referral_id
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN stores st ON st.id = pc.store_id
    WHERE pc.payout_month = ${month} AND pc.status IN ('validated', 'paid')
    ORDER BY p.partner_code, pc.billed_at`));
}

// ── Months, levels and status history ─────────────────────────────────────────

export type PartnerMonth = {
  month: string; eligibleSales: number; byStore: Record<string, number>; commissionLevel: number; commissionPercent: number;
  commission: number; bonus: number; partnershipLevel: number | null; paidAt: string | null; reference: string | null; ruleVersionId: number;
};

/** A partner's months with bills, newest first. The current month is an estimate until it ends and is verified. */
export async function partnerMonths(partnerId: number): Promise<PartnerMonth[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT * FROM partner_months WHERE partner_id = ${partnerId} ORDER BY month DESC`)).map((m) => ({
    month: String(m.month), eligibleSales: num(m.eligible_sales), byStore: (m.by_store as Record<string, number>) ?? {},
    commissionLevel: Number(m.commission_level), commissionPercent: num(m.commission_percent), commission: num(m.commission), bonus: num(m.bonus),
    partnershipLevel: numOrNull(m.partnership_level), paidAt: iso(m.paid_at), reference: (m.payout_reference as string) ?? null, ruleVersionId: Number(m.rule_version_id),
  }));
}

/** This month so far: eligible sales, the commission level reached, the estimate, and what the next level needs. */
export type MonthProgress = {
  month: string; eligibleSales: number; level: RuleLevel; commission: number; bonus: number;
  next: { level: RuleLevel; needed: number } | null;
};
export async function monthProgress(partnerId: number): Promise<MonthProgress> {
  const month = thisMonthIst();
  const [rules, months] = await Promise.all([rulesFor(month), partnerMonths(partnerId)]);
  const m = months.find((x) => x.month === month);
  const eligibleSales = m?.eligibleSales ?? 0;
  const level = levelFor(rules.levels, eligibleSales);
  const nextLevel = rules.levels.find((l) => l.level === level.level + 1);
  return {
    // The month's own figures when it has any (campaign rates, holds and shares included); otherwise nothing yet.
    month, eligibleSales, level: m ? (rules.levels.find((l) => l.level === m.commissionLevel) ?? level) : level,
    commission: m ? m.commission : 0, bonus: m && eligibleSales > 0 ? m.bonus : 0,
    next: nextLevel ? { level: nextLevel, needed: Math.max(0, nextLevel.minSales - eligibleSales) } : null,
  };
}

export type LevelChange = {
  kind: 'monthly' | 'manual'; reviewMonth: string | null; monthsCounted: number | null; averageSales: number | null; qualifyingLevel: number | null;
  previousLevel: number; newLevel: number; belowStreak: number | null; effectiveMonth: string; note: string | null; changedBy: string | null; at: string;
};
export async function levelHistory(partnerId: number): Promise<LevelChange[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT * FROM partner_level_reviews WHERE partner_id = ${partnerId} ORDER BY created_at DESC, id DESC LIMIT 36`)).map((r) => ({
    kind: r.kind as 'monthly' | 'manual', reviewMonth: (r.review_month as string) ?? null, monthsCounted: numOrNull(r.months_counted),
    averageSales: numOrNull(r.average_sales), qualifyingLevel: numOrNull(r.qualifying_level), previousLevel: Number(r.previous_level), newLevel: Number(r.new_level),
    belowStreak: numOrNull(r.below_streak), effectiveMonth: String(r.effective_month), note: (r.note as string) ?? null, changedBy: (r.changed_by as string) ?? null, at: iso(r.created_at)!,
  }));
}

export type StatusChange = { from: PartnerStatus | null; to: PartnerStatus; reason: string; by: string; at: string };
export async function statusLog(partnerId: number): Promise<StatusChange[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT * FROM partner_status_log WHERE partner_id = ${partnerId} ORDER BY changed_at DESC, id DESC`)).map((r) => ({
    from: (r.from_status as PartnerStatus) ?? null, to: r.to_status as PartnerStatus, reason: String(r.reason), by: String(r.changed_by), at: iso(r.changed_at)!,
  }));
}

/** The average the next month-end review will use, with the months it covers (the approval month never counts). */
export async function reviewOutlook(partnerId: number, approvedAt: string | null): Promise<{ months: string[]; average: number; qualifying: RuleLevel } | null> {
  if (!approvedAt) return null;
  const month = thisMonthIst();
  const rules = await rulesFor(month);
  const firstFull = shiftMonth(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date(approvedAt)), 1);
  if (firstFull > month) return null;
  const months: string[] = [];
  for (let k = rules.terms.reviewMonths - 1; k >= 0; k--) {
    const m = shiftMonth(month, -k);
    if (m >= firstFull) months.push(m);
  }
  const values = await partnerMonths(partnerId);
  const average = months.reduce((s, m) => s + (values.find((v) => v.month === m)?.eligibleSales ?? 0), 0) / months.length;
  return { months, average, qualifying: levelFor(rules.levels, average) };
}

// ── Partner dashboard ─────────────────────────────────────────────────────────

/** What a partner sees on their private link: their own referrals, statuses and commission. No phone numbers or bill amounts. */
export type PartnerDashboard = {
  id: number; code: string; name: string; category: string; status: PartnerStatus; level: number; levelName: string; windowDays: number;
  personalDiscount: number; month: MonthProgress;
  referrals: { id: number; name: string; occasion: string; registeredAt: string; windowEndsOn: string; status: ReferralStatus; declineReason: DeclineReason | null;
    toVerify: boolean; commission: { status: CommissionStatus; amount: number | null; payoutMonth: string | null }[] }[];
  totals: { referrals: number; open: number; converted: number; pendingBills: number; validated: number; paid: number; bonusesPaid: number };
};

/** First name and the initial of the last: "Priya S." */
const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};

export async function dashboardFor(token: string): Promise<PartnerDashboard | null> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const [p] = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT p.id, p.partner_code, p.full_name, p.category, p.status, p.level
    FROM partners p WHERE p.dashboard_token = ${token} AND p.status IN ${ISSUED_STATUSES}`));
  if (!p) return null;
  const [referrals, rules, month, months] = await Promise.all([listReferrals({ partnerId: Number(p.id), limit: 1000 }), rulesFor(), monthProgress(Number(p.id)), partnerMonths(Number(p.id))]);
  const level = rules.levels.find((l) => l.level === Number(p.level)) ?? rules.levels[0];
  const list = referrals.map((r) => ({
    id: r.id, name: shortName(r.fullName), occasion: r.occasion, registeredAt: r.registeredAt, windowEndsOn: r.windowEndsOn, status: r.status, declineReason: r.declineReason,
    toVerify: r.verifyStatus === 'pending',
    commission: r.commissions.map((c) => ({ status: c.status, amount: c.amount, payoutMonth: c.payoutMonth })),
  }));
  const lines = referrals.flatMap((r) => r.commissions);
  return {
    id: Number(p.id), code: String(p.partner_code), name: String(p.full_name), category: String(p.category), status: p.status as PartnerStatus,
    level: level.level, levelName: level.name, windowDays: rules.terms.referralDays, personalDiscount: level.personalDiscount, month, referrals: list,
    totals: {
      referrals: referrals.filter((r) => r.status !== 'declined').length, open: referrals.filter((r) => r.status === 'registered').length,
      converted: referrals.filter((r) => r.status === 'converted').length, pendingBills: lines.filter((c) => c.status === 'pending').length,
      validated: lines.filter((c) => c.status === 'validated').reduce((s, c) => s + (c.amount ?? 0), 0),
      paid: lines.filter((c) => c.status === 'paid').reduce((s, c) => s + (c.amount ?? 0), 0),
      bonusesPaid: months.filter((m) => m.paidAt).reduce((s, m) => s + m.bonus, 0),
    },
  };
}
