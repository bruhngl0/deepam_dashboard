/** Ananta Partner Network reads for the module pages and the partner dashboard. Call `refreshReferrals()` first on a page. */

import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { PARTNER_CODE, REQUIRED_DOCUMENTS, type CommissionStatus, type DeclineReason, type PartnerStatus, type ReferralStatus } from './constants';
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

export type Level = { level: number; name: string; percent: number | null; notes: string | null };
export type Rules = { levels: Level[]; windowDays: number; lookbackYears: number };

export async function getRules(): Promise<Rules> {
  const [levels, settings] = await Promise.all([
    db.execute(sql`SELECT level, name, commission_percent, notes FROM partner_levels ORDER BY level`),
    db.execute(sql`SELECT partner_setting_int('partner_purchase_window_days', 60) AS window_days, partner_setting_int('partner_lookback_years', 2) AS lookback`),
  ]);
  const s = rowsOf<{ window_days: number; lookback: number }>(settings)[0];
  return {
    levels: rowsOf<{ level: number; name: string; commission_percent: string | null; notes: string | null }>(levels)
      .map((l) => ({ level: l.level, name: l.name, percent: numOrNull(l.commission_percent), notes: l.notes })),
    windowDays: Number(s.window_days), lookbackYears: Number(s.lookback),
  };
}

// ── Partners ──────────────────────────────────────────────────────────────────

export type Partner = {
  id: number; code: string | null; fullName: string; contact: string; phone: string; email: string; category: string; city: string;
  status: PartnerStatus; statusNote: string | null; level: number; levelName: string; levelPercent: number | null;
  documents: Record<string, string>; documentsComplete: boolean; dashboardToken: string | null; notes: string | null;
  appliedAt: string; approvedAt: string | null; decidedAt: string | null;
  referrals: number; registered: number; converted: number; declined: number; salesValue: number;
  commissionPending: number; commissionValidated: number; commissionPaid: number; billsToValidate: number;
};

const PARTNER_SELECT = sql`
  SELECT p.*, l.name AS level_name, l.commission_percent AS level_percent,
    coalesce(r.total, 0) AS referrals, coalesce(r.registered, 0) AS registered, coalesce(r.converted, 0) AS converted, coalesce(r.declined, 0) AS declined,
    coalesce(c.sales_value, 0) AS sales_value, coalesce(c.pending_bills, 0) AS pending_bills,
    coalesce(c.pending_estimate, 0) AS pending_estimate, coalesce(c.validated, 0) AS validated, coalesce(c.paid, 0) AS paid
  FROM partners p
  JOIN partner_levels l ON l.level = p.level
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE status <> 'declined') AS total, count(*) FILTER (WHERE status = 'registered') AS registered,
           count(*) FILTER (WHERE status = 'converted') AS converted, count(*) FILTER (WHERE status = 'declined') AS declined
    FROM partner_referrals WHERE partner_id = p.id
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT sum(bill_amount) FILTER (WHERE status <> 'rejected') AS sales_value,
           count(*) FILTER (WHERE status = 'pending') AS pending_bills,
           sum(bill_amount * coalesce(l.commission_percent, 0) / 100) FILTER (WHERE status = 'pending') AS pending_estimate,
           sum(commission_amount) FILTER (WHERE status = 'validated') AS validated,
           sum(commission_amount) FILTER (WHERE status = 'paid') AS paid
    FROM partner_commissions WHERE partner_id = p.id
  ) c ON true`;

type PartnerRow = Record<string, unknown> & { documents: Record<string, string> };
function toPartner(r: PartnerRow): Partner {
  return {
    id: Number(r.id), code: (r.partner_code as string) ?? null, fullName: String(r.full_name), contact: String(r.contact), phone: String(r.phone_e164),
    email: String(r.email), category: String(r.category), city: String(r.city), status: r.status as PartnerStatus, statusNote: (r.status_note as string) ?? null,
    level: Number(r.level), levelName: String(r.level_name), levelPercent: numOrNull(r.level_percent),
    documents: r.documents ?? {}, documentsComplete: REQUIRED_DOCUMENTS.every((k) => !!r.documents?.[k]),
    dashboardToken: (r.dashboard_token as string) ?? null, notes: (r.notes as string) ?? null,
    appliedAt: iso(r.applied_at)!, approvedAt: iso(r.approved_at), decidedAt: iso(r.decided_at),
    referrals: num(r.referrals), registered: num(r.registered), converted: num(r.converted), declined: num(r.declined), salesValue: num(r.sales_value),
    commissionPending: num(r.pending_estimate), commissionValidated: num(r.validated), commissionPaid: num(r.paid), billsToValidate: num(r.pending_bills),
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
    ORDER BY CASE p.status WHEN 'applied' THEN 0 WHEN 'approved' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END, p.applied_at DESC`));
  return rows.map(toPartner);
}

/** By numeric id or Partner ID (DPR-00001). */
export async function getPartner(key: string): Promise<Partner | null> {
  const code = key.toUpperCase();
  const cond = PARTNER_CODE.test(code) ? sql`p.partner_code = ${code}` : /^\d+$/.test(key) ? sql`p.id = ${Number(key)}` : null;
  if (!cond) return null;
  const [row] = rowsOf<PartnerRow>(await db.execute(sql`${PARTNER_SELECT} WHERE ${cond}`));
  return row ? toPartner(row) : null;
}

// ── Referrals ─────────────────────────────────────────────────────────────────

export type Commission = {
  id: number; voucherNo: string; storeName: string | null; billedAt: string; billAmount: number; status: CommissionStatus;
  percent: number | null; amount: number | null; estimate: number | null; payoutMonth: string | null; note: string | null; paidAt: string | null; reference: string | null;
};
export type Referral = {
  id: number; partnerId: number; partnerCode: string | null; partnerName: string; fullName: string; phone: string; customerId: number | null; customerCode: string | null;
  occasion: string; storeName: string | null; appointmentDate: string | null; status: ReferralStatus; declineReason: DeclineReason | null;
  registeredAt: string; windowEndsOn: string; convertedAt: string | null; commissions: Commission[];
};

export type ReferralFilters = Scope & { status?: string; partnerId?: number; search?: string; limit?: number };

export async function listReferrals(f: ReferralFilters = {}): Promise<Referral[]> {
  const where: SQL[] = [sql`true`];
  if (f.status) where.push(sql`r.status = ${f.status}`);
  if (f.partnerId) where.push(sql`r.partner_id = ${f.partnerId}`);
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
    SELECT r.*, p.partner_code, p.full_name AS partner_name, c.customer_code, st.name AS store_name, l.commission_percent AS level_percent,
      coalesce((
        SELECT json_agg(json_build_object('id', pc.id, 'voucher_no', pc.voucher_no, 'store_name', cs.name, 'billed_at', pc.billed_at,
          'bill_amount', pc.bill_amount, 'status', pc.status, 'percent', pc.commission_percent, 'amount', pc.commission_amount,
          'payout_month', pc.payout_month, 'note', pc.note, 'paid_at', pc.paid_at, 'reference', pc.payout_reference) ORDER BY pc.billed_at)
        FROM partner_commissions pc LEFT JOIN stores cs ON cs.id = pc.store_id WHERE pc.referral_id = r.id
      ), '[]'::json) AS commissions
    FROM partner_referrals r
    JOIN partners p ON p.id = r.partner_id
    JOIN partner_levels l ON l.level = p.level
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN stores st ON st.id = r.preferred_store_id
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY r.registered_at DESC, r.id DESC
    LIMIT ${f.limit ?? 500}`));
  return rows.map((r) => {
    const levelPercent = numOrNull(r.level_percent);
    return {
      id: Number(r.id), partnerId: Number(r.partner_id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.partner_name),
      fullName: String(r.full_name), phone: String(r.phone_e164), customerId: numOrNull(r.customer_id), customerCode: (r.customer_code as string) ?? null,
      occasion: String(r.occasion), storeName: (r.store_name as string) ?? null, appointmentDate: day(r.appointment_date),
      status: r.status as ReferralStatus, declineReason: (r.decline_reason as DeclineReason) ?? null,
      registeredAt: iso(r.registered_at)!, windowEndsOn: day(r.window_ends_on)!, convertedAt: iso(r.converted_at),
      commissions: (r.commissions as Record<string, unknown>[]).map((c) => ({
        id: Number(c.id), voucherNo: String(c.voucher_no), storeName: (c.store_name as string) ?? null, billedAt: String(c.billed_at), billAmount: num(c.bill_amount),
        status: c.status as CommissionStatus, percent: numOrNull(c.percent), amount: numOrNull(c.amount),
        estimate: c.status === 'pending' && levelPercent !== null ? Math.round(num(c.bill_amount) * levelPercent) / 100 : null,
        payoutMonth: (c.payout_month as string) ?? null, note: (c.note as string) ?? null, paidAt: (c.paid_at as string) ?? null, reference: (c.reference as string) ?? null,
      })),
    };
  });
}

/** Bills matched to referrals that staff have not validated or rejected yet, oldest first. */
export type PendingCommission = {
  id: number; partnerId: number; partnerCode: string | null; partnerName: string; level: number; percent: number | null;
  customerName: string; customerCode: string | null; phone: string; registeredAt: string;
  voucherNo: string; storeName: string | null; billedAt: string; billAmount: number; estimate: number | null;
};

export async function pendingCommissions(f: Scope = {}): Promise<PendingCommission[]> {
  const rows = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT pc.id, pc.partner_id, p.partner_code, p.full_name AS partner_name, p.level, l.commission_percent,
      r.full_name AS customer_name, c.customer_code, r.phone_e164, r.registered_at, pc.voucher_no, st.name AS store_name, pc.billed_at, pc.bill_amount
    FROM partner_commissions pc
    JOIN partner_referrals r ON r.id = pc.referral_id
    JOIN partners p ON p.id = pc.partner_id
    JOIN partner_levels l ON l.level = p.level
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN stores st ON st.id = pc.store_id
    WHERE pc.status = 'pending' AND ${where_(commissionScope(f))}
    ORDER BY pc.billed_at, pc.id`));
  return rows.map((r) => {
    const percent = numOrNull(r.commission_percent);
    return {
      id: Number(r.id), partnerId: Number(r.partner_id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.partner_name),
      level: Number(r.level), percent, customerName: String(r.customer_name), customerCode: (r.customer_code as string) ?? null, phone: String(r.phone_e164),
      registeredAt: iso(r.registered_at)!, voucherNo: String(r.voucher_no), storeName: (r.store_name as string) ?? null,
      billedAt: iso(r.billed_at)!, billAmount: num(r.bill_amount), estimate: percent === null ? null : Math.round(num(r.bill_amount) * percent) / 100,
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
        (SELECT count(*) FROM partners WHERE status = 'suspended') AS suspended,
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
      FROM partners p WHERE p.status IN ('approved', 'suspended')
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
  bills: number; billValue: number; validated: number; paid: number; paidAt: string | null; references: string[];
};

/** Per partner, the commissions in `month`'s payout cycle: validated (to pay) and paid. */
export async function payouts(month: string): Promise<PayoutLine[]> {
  const rows = rowsOf<Record<string, unknown> & { documents: Record<string, string> }>(await db.execute(sql`
    SELECT p.id, p.partner_code, p.full_name, p.phone_e164, p.email, p.documents,
      count(*) AS bills, sum(pc.bill_amount) AS bill_value,
      coalesce(sum(pc.commission_amount) FILTER (WHERE pc.status = 'validated'), 0) AS validated,
      coalesce(sum(pc.commission_amount) FILTER (WHERE pc.status = 'paid'), 0) AS paid,
      max(pc.paid_at) AS paid_at, array_remove(array_agg(DISTINCT pc.payout_reference), NULL) AS refs
    FROM partner_commissions pc JOIN partners p ON p.id = pc.partner_id
    WHERE pc.payout_month = ${month} AND pc.status IN ('validated', 'paid')
    GROUP BY p.id ORDER BY p.partner_code`));
  return rows.map((r) => ({
    partnerId: Number(r.id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.full_name), phone: String(r.phone_e164), email: String(r.email),
    documentsComplete: REQUIRED_DOCUMENTS.every((k) => !!r.documents?.[k]), bills: num(r.bills), billValue: num(r.bill_value),
    validated: num(r.validated), paid: num(r.paid), paidAt: iso(r.paid_at), references: (r.refs as string[]) ?? [],
  }));
}

/** Every commission line in a month's payout cycle, for the CSV. */
export async function payoutLines(month: string) {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT p.partner_code, p.full_name AS partner_name, p.category, r.full_name AS customer_name, c.customer_code,
      pc.voucher_no, st.name AS store, pc.billed_at, pc.bill_amount, pc.level, pc.commission_percent, pc.commission_amount,
      pc.status, pc.paid_at, pc.payout_reference
    FROM partner_commissions pc
    JOIN partners p ON p.id = pc.partner_id
    JOIN partner_referrals r ON r.id = pc.referral_id
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN stores st ON st.id = pc.store_id
    WHERE pc.payout_month = ${month} AND pc.status IN ('validated', 'paid')
    ORDER BY p.partner_code, pc.billed_at`));
}

// ── Partner dashboard ─────────────────────────────────────────────────────────

/** What a partner sees on their private link: their own referrals, statuses and commission. No phone numbers or bill amounts. */
export type PartnerDashboard = {
  code: string; name: string; category: string; status: PartnerStatus; level: number; levelName: string; windowDays: number;
  referrals: { id: number; name: string; occasion: string; registeredAt: string; windowEndsOn: string; status: ReferralStatus; declineReason: DeclineReason | null;
    commission: { status: CommissionStatus; amount: number | null; payoutMonth: string | null }[] }[];
  totals: { referrals: number; open: number; converted: number; pendingBills: number; validated: number; paid: number };
};

/** First name and the initial of the last: "Priya S." */
const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};

export async function dashboardFor(token: string): Promise<PartnerDashboard | null> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const [p] = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT p.id, p.partner_code, p.full_name, p.category, p.status, p.level, l.name AS level_name
    FROM partners p JOIN partner_levels l ON l.level = p.level WHERE p.dashboard_token = ${token} AND p.status IN ('approved', 'suspended')`));
  if (!p) return null;
  const [referrals, rules] = await Promise.all([listReferrals({ partnerId: Number(p.id), limit: 1000 }), getRules()]);
  const list = referrals.map((r) => ({
    id: r.id, name: shortName(r.fullName), occasion: r.occasion, registeredAt: r.registeredAt, windowEndsOn: r.windowEndsOn, status: r.status, declineReason: r.declineReason,
    commission: r.commissions.map((c) => ({ status: c.status, amount: c.amount, payoutMonth: c.payoutMonth })),
  }));
  const lines = referrals.flatMap((r) => r.commissions);
  return {
    code: String(p.partner_code), name: String(p.full_name), category: String(p.category), status: p.status as PartnerStatus,
    level: Number(p.level), levelName: String(p.level_name), windowDays: rules.windowDays, referrals: list,
    totals: {
      referrals: referrals.filter((r) => r.status !== 'declined').length, open: referrals.filter((r) => r.status === 'registered').length,
      converted: referrals.filter((r) => r.status === 'converted').length, pendingBills: lines.filter((c) => c.status === 'pending').length,
      validated: lines.filter((c) => c.status === 'validated').reduce((s, c) => s + (c.amount ?? 0), 0),
      paid: lines.filter((c) => c.status === 'paid').reduce((s, c) => s + (c.amount ?? 0), 0),
    },
  };
}
