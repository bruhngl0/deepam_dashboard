/**
 * Reads for the Settlements, Controls and Programs pages and the partner dashboard (drizzle/0048). Plain rows with
 * numbers as numbers; customer contact details are never part of anything shown to a partner.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { rowsOf } from './store';
import type { SettlementStatus } from './program';

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));

export type Allocation = Record<string, { commission: number; bonus: number; collab: number; incentives: number; adjustments: number; total: number }>;

export type Settlement = {
  id: number; partnerId: number; partnerCode: string | null; partnerName: string; partnerStatus: string; documentsComplete: boolean;
  month: string; status: SettlementStatus; opening: number; eligibleSales: number; thresholdSales: number; byStore: Record<string, number>;
  level: number | null; percent: number | null; standard: number; campaign: number; bonus: number; collab: number; incentives: number; adjustments: number;
  gross: number; tdsBase: number; tdsPercent: number; tds: number; net: number; paid: number; closing: number; heldLines: number; allocation: Allocation;
  verifiedBy: string | null; verifiedAt: string | null; approvedBy: string | null; approvedAt: string | null; holdReason: string | null; adjustedAt: string | null;
  ruleVersionId: number | null; statement: { lines: { voucher: string; store: string; net: number; campaign: number | null; share: number }[] } | null;
};

const toSettlement = (r: Record<string, unknown>): Settlement => ({
  id: n(r.id), partnerId: n(r.partner_id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.full_name), partnerStatus: String(r.partner_status),
  documentsComplete: Boolean(r.documents_complete),
  month: String(r.month), status: r.status as SettlementStatus, opening: n(r.opening_balance), eligibleSales: n(r.eligible_sales), thresholdSales: n(r.threshold_sales),
  byStore: Object.fromEntries(Object.entries((r.by_store as Record<string, unknown>) ?? {}).map(([k, v]) => [k, n(v)])),
  level: r.commission_level === null ? null : n(r.commission_level), percent: r.commission_percent === null ? null : n(r.commission_percent),
  standard: n(r.standard_commission), campaign: n(r.campaign_commission), bonus: n(r.bonus), collab: n(r.collab_fees), incentives: n(r.incentives), adjustments: n(r.adjustments),
  gross: n(r.gross), tdsBase: n(r.tds_base), tdsPercent: n(r.tds_percent), tds: n(r.tds), net: n(r.net_payable), paid: n(r.paid_amount), closing: n(r.closing_balance),
  heldLines: n(r.held_lines), allocation: (r.allocation as Allocation) ?? {},
  verifiedBy: (r.verified_by as string) ?? null, verifiedAt: iso(r.verified_at), approvedBy: (r.approved_by as string) ?? null, approvedAt: iso(r.approved_at),
  holdReason: (r.hold_reason as string) ?? null, adjustedAt: iso(r.adjusted_at), ruleVersionId: r.rule_version_id === null ? null : n(r.rule_version_id),
  statement: (r.statement as Settlement['statement']) ?? null,
});

const SETTLEMENT_SELECT = sql`
  SELECT s.*, p.partner_code, p.full_name, p.status AS partner_status,
    COALESCE(p.documents, '{}'::jsonb) ?& ARRAY['agreement', 'pan', 'id_proof', 'bank'] AS documents_complete
  FROM partner_settlements s JOIN partners p ON p.id = s.partner_id`;

export async function settlements(month: string): Promise<Settlement[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`${SETTLEMENT_SELECT} WHERE s.month = ${month} ORDER BY s.net_payable DESC, p.full_name`)).map(toSettlement);
}
export async function settlement(id: number): Promise<Settlement | null> {
  const [r] = rowsOf<Record<string, unknown>>(await db.execute(sql`${SETTLEMENT_SELECT} WHERE s.id = ${id}`));
  return r ? toSettlement(r) : null;
}
export async function partnerSettlements(partnerId: number): Promise<Settlement[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`${SETTLEMENT_SELECT} WHERE s.partner_id = ${partnerId} ORDER BY s.month DESC`)).map(toSettlement);
}

export type Payment = { id: number; amount: number; paidOn: string; reference: string; by: string; at: string };
export async function payments(settlementId: number): Promise<Payment[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`SELECT * FROM partner_settlement_payments WHERE settlement_id = ${settlementId} ORDER BY id`)).map((r) => ({
    id: n(r.id), amount: n(r.amount), paidOn: String(iso(r.paid_on)).slice(0, 10), reference: String(r.reference), by: String(r.recorded_by), at: String(iso(r.created_at)),
  }));
}

export type Adjustment = { id: number; partnerId: number; partnerCode: string | null; partnerName: string; kind: 'recalc' | 'manual'; month: string; amount: number; reason: string;
  by: string; approvedBy: string | null; appliedTo: string | null; at: string };
export async function adjustments(f: { partnerId?: number; settlementId?: number; unapproved?: boolean } = {}): Promise<Adjustment[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT a.*, p.partner_code, p.full_name, s.month AS applied_month FROM partner_adjustments a JOIN partners p ON p.id = a.partner_id
    LEFT JOIN partner_settlements s ON s.id = a.applied_settlement_id
    WHERE true ${f.partnerId ? sql`AND a.partner_id = ${f.partnerId}` : sql``} ${f.settlementId ? sql`AND a.applied_settlement_id = ${f.settlementId}` : sql``}
      ${f.unapproved ? sql`AND a.kind = 'manual' AND a.approved_by IS NULL` : sql``}
    ORDER BY a.created_at DESC LIMIT 200`)).map((r) => ({
    id: n(r.id), partnerId: n(r.partner_id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.full_name), kind: r.kind as 'recalc' | 'manual',
    month: String(r.month), amount: n(r.amount), reason: String(r.reason), by: String(r.created_by), approvedBy: (r.approved_by as string) ?? null,
    appliedTo: (r.applied_month as string) ?? null, at: String(iso(r.created_at)),
  }));
}

/** Expense by entity for a month's statements (verified and later), for the brand-wise reconciliation. */
export async function entityReport(month: string) {
  const rows = rowsOf<{ entity: string; commission: string; bonus: string; collab: string; incentives: string; adjustments: string; total: string; sales: string }>(await db.execute(sql`
    WITH a AS (
      SELECT e.key AS entity, (e.value ->> 'commission')::numeric AS commission, (e.value ->> 'bonus')::numeric AS bonus, (e.value ->> 'collab')::numeric AS collab,
        (e.value ->> 'incentives')::numeric AS incentives, (e.value ->> 'adjustments')::numeric AS adjustments, (e.value ->> 'total')::numeric AS total
      FROM partner_settlements s, jsonb_each(s.allocation) e WHERE s.month = ${month}
    ), sales AS (
      SELECT partner_entity_of(b.key) AS entity, sum(b.value::numeric) AS sales FROM partner_settlements s, jsonb_each_text(s.by_store) b WHERE s.month = ${month} GROUP BY 1
    )
    SELECT COALESCE(a.entity, sales.entity) AS entity, COALESCE(sum(a.commission), 0) AS commission, COALESCE(sum(a.bonus), 0) AS bonus, COALESCE(sum(a.collab), 0) AS collab,
      COALESCE(sum(a.incentives), 0) AS incentives, COALESCE(sum(a.adjustments), 0) AS adjustments, COALESCE(sum(a.total), 0) AS total, COALESCE(max(sales.sales), 0) AS sales
    FROM a FULL JOIN sales ON sales.entity = a.entity GROUP BY 1 ORDER BY 1`));
  return rows.map((r) => ({ entity: r.entity, commission: n(r.commission), bonus: n(r.bonus), collab: n(r.collab), incentives: n(r.incentives), adjustments: n(r.adjustments), total: n(r.total), sales: n(r.sales) }));
}

// ── Controls ──────────────────────────────────────────────────────────────────

export type Claim = { id: number; voucher: string; billAmount: number | null; billedAt: string | null; partnerCode: string | null; partnerName: string | null;
  claimantType: string; claimantName: string; note: string | null; status: 'open' | 'resolved'; resolution: string | null; share: number | null;
  resolvedBy: string | null; resolvedReason: string | null; by: string; at: string };
export async function claims(open?: boolean): Promise<Claim[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT c.*, s.bill_amount, s.billed_at, p.partner_code, p.full_name FROM partner_claims c
    LEFT JOIN sales s ON s.voucher_no = c.voucher_no LEFT JOIN partner_commissions pc ON pc.voucher_no = c.voucher_no LEFT JOIN partners p ON p.id = pc.partner_id
    ${open === undefined ? sql`` : sql`WHERE c.status = ${open ? 'open' : 'resolved'}`} ORDER BY c.status, c.created_at DESC LIMIT 200`)).map((r) => ({
    id: n(r.id), voucher: String(r.voucher_no), billAmount: r.bill_amount === null ? null : n(r.bill_amount), billedAt: iso(r.billed_at),
    partnerCode: (r.partner_code as string) ?? null, partnerName: (r.full_name as string) ?? null, claimantType: String(r.claimant_type), claimantName: String(r.claimant_name),
    note: (r.note as string) ?? null, status: r.status as Claim['status'], resolution: (r.resolution as string) ?? null, share: r.partner_share_percent === null ? null : n(r.partner_share_percent),
    resolvedBy: (r.resolved_by as string) ?? null, resolvedReason: (r.resolved_reason as string) ?? null, by: String(r.created_by), at: String(iso(r.created_at)),
  }));
}

export type Flag = { id: number; kind: string; partnerId: number | null; partnerCode: string | null; partnerName: string | null; voucher: string | null; detail: string;
  status: 'open' | 'cleared' | 'confirmed'; by: string; resolvedBy: string | null; resolvedReason: string | null; at: string };
export async function flags(open?: boolean): Promise<Flag[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT f.*, p.partner_code, p.full_name FROM partner_flags f LEFT JOIN partners p ON p.id = f.partner_id
    ${open === undefined ? sql`` : open ? sql`WHERE f.status = 'open'` : sql`WHERE f.status <> 'open'`} ORDER BY (f.status = 'open') DESC, f.created_at DESC LIMIT 200`)).map((r) => ({
    id: n(r.id), kind: String(r.kind), partnerId: r.partner_id === null ? null : n(r.partner_id), partnerCode: (r.partner_code as string) ?? null, partnerName: (r.full_name as string) ?? null,
    voucher: (r.voucher_no as string) ?? null, detail: String(r.detail), status: r.status as Flag['status'], by: String(r.created_by),
    resolvedBy: (r.resolved_by as string) ?? null, resolvedReason: (r.resolved_reason as string) ?? null, at: String(iso(r.created_at)),
  }));
}

// ── Programs ──────────────────────────────────────────────────────────────────

export type Campaign = { id: number; name: string; startsOn: string; endsOn: string; storeCodes: string[]; excludedInvoices: string[]; percent: number; priority: number;
  countsTowardLevel: boolean; bonusEligible: boolean; personalDiscountAllowed: boolean; minMargin: number | null; status: 'draft' | 'active' | 'ended'; notes: string | null;
  by: string; approvedBy: string | null; bills: number; sales: number; commission: number };
export async function campaigns(): Promise<Campaign[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT c.*, count(pc.id) AS bills, COALESCE(sum(COALESCE(pc.net_amount, pc.bill_amount)), 0) AS sales,
      COALESCE(sum(round(COALESCE(pc.net_amount, pc.bill_amount) * COALESCE(pc.share_percent, 100) / 100 * c.commission_percent / 100, 2)) FILTER (WHERE NOT pc.on_hold AND NOT pc.excluded), 0) AS commission
    FROM partner_campaigns c LEFT JOIN partner_commissions pc ON pc.campaign_id = c.id AND pc.status <> 'rejected'
    GROUP BY c.id ORDER BY (c.status = 'active') DESC, c.starts_on DESC`)).map((r) => ({
    id: n(r.id), name: String(r.name), startsOn: String(iso(r.starts_on)).slice(0, 10), endsOn: String(iso(r.ends_on)).slice(0, 10), storeCodes: (r.store_codes as string[]) ?? [],
    excludedInvoices: (r.excluded_invoices as string[]) ?? [], percent: n(r.commission_percent), priority: n(r.priority), countsTowardLevel: Boolean(r.counts_toward_level),
    bonusEligible: Boolean(r.bonus_eligible), personalDiscountAllowed: Boolean(r.personal_discount_allowed), minMargin: r.min_margin_percent === null ? null : n(r.min_margin_percent),
    status: r.status as Campaign['status'], notes: (r.notes as string) ?? null, by: String(r.created_by), approvedBy: (r.approved_by as string) ?? null,
    bills: n(r.bills), sales: n(r.sales), commission: n(r.commission),
  }));
}

export async function exclusions() {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`SELECT * FROM partner_exclusions ORDER BY (to_on IS NULL OR to_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date) DESC, from_on DESC`)).map((r) => ({
    id: n(r.id), scope: String(r.scope), value: String(r.value), fromOn: String(iso(r.from_on)).slice(0, 10), toOn: r.to_on ? String(iso(r.to_on)).slice(0, 10) : null,
    reason: String(r.reason), by: String(r.created_by),
  }));
}

export type Collaboration = { id: number; partnerId: number; partnerCode: string | null; partnerName: string; entity: string; title: string; deliverables: string; dueOn: string;
  amount: number; status: 'pending' | 'approved' | 'rejected' | 'completed' | 'paid'; approvalMonth: string | null; limitAtApproval: number | null; exception: string | null;
  by: string; approvedBy: string | null; rejectedReason: string | null; completedAt: string | null };
export async function collaborations(partnerId?: number): Promise<Collaboration[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT c.*, p.partner_code, p.full_name FROM partner_collaborations c JOIN partners p ON p.id = c.partner_id
    ${partnerId ? sql`WHERE c.partner_id = ${partnerId}` : sql``} ORDER BY (c.status IN ('pending', 'approved')) DESC, c.created_at DESC LIMIT 300`)).map((r) => ({
    id: n(r.id), partnerId: n(r.partner_id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.full_name), entity: String(r.entity), title: String(r.title),
    deliverables: String(r.deliverables), dueOn: String(iso(r.due_on)).slice(0, 10), amount: n(r.amount), status: r.status as Collaboration['status'],
    approvalMonth: (r.approval_month as string) ?? null, limitAtApproval: r.limit_at_approval === null ? null : n(r.limit_at_approval), exception: (r.exception_reason as string) ?? null,
    by: String(r.requested_by), approvedBy: (r.approved_by as string) ?? null, rejectedReason: (r.rejected_reason as string) ?? null, completedAt: iso(r.completed_at),
  }));
}

export type Incentive = { id: number; name: string; kind: string; minSales: number; months: number; categories: string[]; levels: number[]; startsOn: string; endsOn: string;
  reward: number; maxPayout: number | null; entity: string | null; status: 'draft' | 'active' | 'ended'; notes: string | null; by: string; approvedBy: string | null; awards: number; awarded: number };
export async function incentives(): Promise<Incentive[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT i.*, count(a.id) AS awards, COALESCE(sum(a.amount), 0) AS awarded FROM partner_incentives i LEFT JOIN partner_incentive_awards a ON a.incentive_id = i.id
    GROUP BY i.id ORDER BY (i.status = 'active') DESC, i.created_at DESC`)).map((r) => ({
    id: n(r.id), name: String(r.name), kind: String(r.kind), minSales: n(r.min_sales), months: n(r.months), categories: (r.categories as string[]) ?? [], levels: ((r.levels as number[]) ?? []).map(Number),
    startsOn: String(iso(r.starts_on)).slice(0, 10), endsOn: String(iso(r.ends_on)).slice(0, 10), reward: n(r.reward), maxPayout: r.max_payout === null ? null : n(r.max_payout),
    entity: (r.entity as string) ?? null, status: r.status as Incentive['status'], notes: (r.notes as string) ?? null, by: String(r.created_by), approvedBy: (r.approved_by as string) ?? null,
    awards: n(r.awards), awarded: n(r.awarded),
  }));
}

export type PersonalPurchase = { id: number; partnerId: number; partnerCode: string | null; partnerName: string; voucher: string; purchaseOn: string; value: number; level: number;
  percent: number; eligible: number; discount: number; by: string; returned: boolean };
export async function personalPurchases(partnerId?: number): Promise<PersonalPurchase[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT pp.*, p.partner_code, p.full_name, COALESCE(s.fully_returned OR s.returned_amount > 0, false) AS returned
    FROM partner_personal_purchases pp JOIN partners p ON p.id = pp.partner_id LEFT JOIN sales s ON s.voucher_no = pp.voucher_no
    ${partnerId ? sql`WHERE pp.partner_id = ${partnerId}` : sql``} ORDER BY pp.purchase_on DESC, pp.id DESC LIMIT 300`)).map((r) => ({
    id: n(r.id), partnerId: n(r.partner_id), partnerCode: (r.partner_code as string) ?? null, partnerName: String(r.full_name), voucher: String(r.voucher_no),
    purchaseOn: String(iso(r.purchase_on)).slice(0, 10), value: n(r.purchase_value), level: n(r.partnership_level), percent: n(r.discount_percent), eligible: n(r.eligible_value),
    discount: n(r.discount_amount), by: String(r.recorded_by), returned: Boolean(r.returned),
  }));
}

/** Active partners for the pickers on Programs and Controls. */
export async function activePartners() {
  return rowsOf<{ id: number; partner_code: string; full_name: string }>(await db.execute(sql`
    SELECT id, partner_code, full_name FROM partners WHERE status IN ('approved', 'on_hold', 'suspended') AND partner_code IS NOT NULL ORDER BY full_name`));
}

/** Campaigns running today, for the partner dashboard. */
export async function activeCampaignsToday() {
  return rowsOf<{ name: string; ends_on: string; commission_percent: string; store_codes: string[] }>(await db.execute(sql`
    SELECT name, ends_on::text, commission_percent, store_codes FROM partner_campaigns
    WHERE status = 'active' AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN starts_on AND ends_on ORDER BY priority, id`)).map((c) => ({
    name: c.name, endsOn: c.ends_on, percent: n(c.commission_percent), stores: c.store_codes,
  }));
}
