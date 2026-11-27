/**
 * Ananta Partner Network rules (program rules v1.0, drizzle/0047): the levels table, referral and review terms, and
 * partner categories. Rules are versions: a save adds a version that takes effect from a chosen month (the next
 * month by default) with who saved it and why; a month's commission always uses the version in force that month.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { MONTH } from './constants';
import { PartnerError, rowsOf } from './store';

export type RuleLevel = {
  level: number; name: string; minSales: number; commissionPercent: number; bonus: number;
  influencerLimit: number; personalDiscount: number; benefits: string;
};
export type RuleTerms = {
  referralDays: number; lookbackYears: number; reviewMonths: number; downgradeAfter: number; annualShoppingLimit: number;
  // Settlement (drizzle/0048): TDS, the minimum payout, the settlement calendar and the large-bill review threshold.
  tdsPercent: number; tdsAnnualThreshold: number; minPayout: number; verifyByDay: number; approveByDay: number; payByDay: number; largeBillFlag: number;
  existingCustomers?: boolean;
};
export type RuleVersion = { id: number; effectiveMonth: string; levels: RuleLevel[]; terms: RuleTerms; reason: string; changedBy: string; createdAt: string };

const toVersion = (r: Record<string, unknown>): RuleVersion => ({
  id: Number(r.id), effectiveMonth: String(r.effective_month), levels: r.levels as RuleLevel[], terms: r.terms as RuleTerms,
  reason: String(r.reason), changedBy: String(r.changed_by), createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
});

export const thisMonthIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

/** The rules in force for a month (default: this month). */
export async function rulesFor(month = thisMonthIst()): Promise<RuleVersion> {
  const [r] = rowsOf<Record<string, unknown>>(await db.execute(sql`SELECT * FROM partner_rules_for(${month})`));
  if (!r?.id) throw new Error('No partner rules version in force');
  return toVersion(r);
}

/** Every version, newest first. */
export async function ruleHistory(): Promise<RuleVersion[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`SELECT * FROM partner_rule_versions ORDER BY created_at DESC, id DESC`)).map(toVersion);
}

/** A version saved for a later month that is not in force yet. */
export async function scheduledVersions(): Promise<RuleVersion[]> {
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT * FROM partner_rule_versions WHERE effective_month > ${thisMonthIst()} ORDER BY effective_month, id`)).map(toVersion);
}

/** The level a month's eligible sales reach: the highest whose minimum they meet. */
export function levelFor(levels: RuleLevel[], value: number): RuleLevel {
  return [...levels].sort((a, b) => b.minSales - a.minSales).find((l) => value >= l.minSales) ?? levels[0];
}

/** Checks a levels table: five levels, Level 1 from ₹0, minimums rising, percentages 0–100, amounts not negative. */
export function checkLevels(levels: RuleLevel[]): RuleLevel[] {
  if (levels.length !== 5) throw new PartnerError('There must be five levels');
  levels.forEach((l, i) => {
    const label = `Level ${i + 1}`;
    if (l.level !== i + 1) throw new PartnerError(`${label}: wrong level number`);
    for (const [key, v] of [['minimum monthly sales', l.minSales], ['bonus', l.bonus], ['influencer fee limit', l.influencerLimit]] as const) {
      if (!Number.isFinite(v) || v < 0) throw new PartnerError(`${label}: ${key} should be ₹0 or more`);
    }
    for (const [key, v] of [['commission', l.commissionPercent], ['personal discount', l.personalDiscount]] as const) {
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new PartnerError(`${label}: ${key} should be 0 to 100%`);
    }
    if (!l.name.trim()) throw new PartnerError(`${label}: give it a name`);
  });
  if (levels[0].minSales !== 0) throw new PartnerError('Level 1 starts at ₹0');
  for (let i = 1; i < 5; i++) {
    if (levels[i].minSales <= levels[i - 1].minSales) throw new PartnerError(`Level ${i + 1}'s minimum must be above Level ${i}'s`);
  }
  return levels;
}

export function checkTerms(t: RuleTerms): RuleTerms {
  const whole = (v: number, lo: number, hi: number, what: string) => {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new PartnerError(`${what} should be a whole number from ${lo} to ${hi}`);
  };
  whole(t.referralDays, 1, 365, 'Referral validity (days)');
  whole(t.lookbackYears, 1, 10, 'Existing-customer look-back (years)');
  whole(t.reviewMonths, 1, 12, 'Months averaged for the level review');
  whole(t.downgradeAfter, 1, 12, 'Reviews below before a downgrade');
  if (!Number.isFinite(t.annualShoppingLimit) || t.annualShoppingLimit < 0) throw new PartnerError('Annual personal shopping limit should be ₹0 or more');
  if (!Number.isFinite(t.tdsPercent) || t.tdsPercent < 0 || t.tdsPercent > 30) throw new PartnerError('TDS % should be from 0 to 30');
  for (const [v, what] of [[t.tdsAnnualThreshold, 'TDS threshold'], [t.minPayout, 'Minimum payout'], [t.largeBillFlag, 'Large bill review']] as const) {
    if (!Number.isFinite(v) || v < 0) throw new PartnerError(`${what} should be ₹0 or more`);
  }
  whole(t.verifyByDay, 1, 28, 'Verify by (day)');
  whole(t.approveByDay, t.verifyByDay, 28, 'Approve by (day), on or after verify by');
  whole(t.payByDay, t.approveByDay, 28, 'Pay by (day), on or after approve by');
  return t;
}

/**
 * Saves a new rules version. `effectiveMonth` is this month or later (commission slabs and bonuses normally change from
 * the next month). A reason and the name of who made the change are required.
 */
export async function saveRuleVersion(input: { levels: RuleLevel[]; terms: RuleTerms; effectiveMonth: string; reason: string; changedBy: string }) {
  if (!MONTH.test(input.effectiveMonth)) throw new PartnerError('Choose the month the rules take effect from');
  if (input.effectiveMonth < thisMonthIst()) throw new PartnerError('Rules cannot take effect in a month that has ended: earned months keep their rules');
  if (!input.reason.trim()) throw new PartnerError('Say why the rules are changing');
  if (!input.changedBy.trim()) throw new PartnerError('Enter your name');
  const levels = checkLevels(input.levels), terms = checkTerms(input.terms);
  const current = await rulesFor(input.effectiveMonth);
  if (JSON.stringify(current.levels) === JSON.stringify(levels) && JSON.stringify(current.terms) === JSON.stringify(terms)) {
    throw new PartnerError('Nothing changed');
  }
  await db.transaction(async (t) => {
    await t.execute(sql`
      INSERT INTO partner_rule_versions (effective_month, levels, terms, reason, changed_by)
      VALUES (${input.effectiveMonth}, ${JSON.stringify(levels)}::jsonb, ${JSON.stringify(terms)}::jsonb, ${input.reason.trim()}, ${input.changedBy.trim()})`);
    // Level names also show wherever a partner's level is listed.
    for (const l of levels) await t.execute(sql`UPDATE partner_levels SET name = ${l.name}, updated_at = now() WHERE level = ${l.level}`);
  });
}

/** Removes a version saved for a later month before it takes effect (a mistake). */
export async function cancelScheduledVersion(id: number) {
  const done = rowsOf(await db.execute(sql`DELETE FROM partner_rule_versions WHERE id = ${id} AND effective_month > ${thisMonthIst()} RETURNING id`));
  if (!done.length) throw new PartnerError('Only rules that have not taken effect yet can be cancelled');
}

/** What changed from one version to the next, as "field: old → new" lines. */
export function versionChanges(prev: RuleVersion | undefined, next: RuleVersion): string[] {
  if (!prev) return ['First version'];
  const out: string[] = [];
  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  const fields: [keyof RuleLevel, string, (v: never) => string][] = [
    ['name', 'name', (v: string) => v], ['minSales', 'from', money], ['commissionPercent', 'commission', (v: number) => `${v}%`],
    ['bonus', 'bonus', money], ['influencerLimit', 'influencer limit', money], ['personalDiscount', 'personal discount', (v: number) => `${v}%`],
    ['benefits', 'benefits', (v: string) => v || '—'],
  ];
  next.levels.forEach((l, i) => {
    const p = prev.levels[i];
    for (const [key, label, show] of fields) {
      if (p?.[key] !== l[key]) out.push(`Level ${l.level} ${label}: ${p ? show(p[key] as never) : '—'} → ${show(l[key] as never)}`);
    }
  });
  const terms: [keyof RuleTerms, string][] = [
    ['referralDays', 'Referral validity (days)'], ['lookbackYears', 'Existing-customer look-back (years)'],
    ['reviewMonths', 'Months averaged'], ['downgradeAfter', 'Reviews below before downgrade'], ['annualShoppingLimit', 'Annual shopping limit'],
  ];
  for (const [key, label] of terms) if (prev.terms[key] !== next.terms[key]) out.push(`${label}: ${prev.terms[key]} → ${next.terms[key]}`);
  return out.length ? out : ['No change'];
}

// ── Categories ────────────────────────────────────────────────────────────────

export type Category = { name: string; active: boolean; partners: number };

export async function categories(): Promise<Category[]> {
  return rowsOf<{ name: string; active: boolean; partners: string }>(await db.execute(sql`
    SELECT c.name, c.active, (SELECT count(*) FROM partners p WHERE p.category = c.name) AS partners
    FROM partner_categories c ORDER BY c.sort, c.name`)).map((c) => ({ name: c.name, active: c.active, partners: Number(c.partners) }));
}
/** The names offered on the application form and the partner page. */
export async function activeCategoryNames(): Promise<string[]> {
  return (await categories()).filter((c) => c.active).map((c) => c.name);
}

export async function addCategory(name: string) {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!clean) throw new PartnerError('Enter the category name');
  const done = rowsOf(await db.execute(sql`
    INSERT INTO partner_categories (name, sort) VALUES (${clean}, (SELECT coalesce(max(sort), 0) + 1 FROM partner_categories))
    ON CONFLICT (name) DO UPDATE SET active = true RETURNING name`));
  if (!done.length) throw new PartnerError('Could not add the category');
}
/** Hides a category from the application form; partners already in it keep it. */
export async function setCategoryActive(name: string, active: boolean) {
  await db.execute(sql`UPDATE partner_categories SET active = ${active} WHERE name = ${name}`);
}
/** Renames a category, moving its partners with it. */
export async function renameCategory(from: string, to: string) {
  const clean = to.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!clean) throw new PartnerError('Enter the new name');
  if (clean === from) return;
  await db.transaction(async (t) => {
    const exists = rowsOf(await t.execute(sql`SELECT 1 FROM partner_categories WHERE name = ${clean}`));
    if (exists.length) throw new PartnerError(`“${clean}” already exists`);
    await t.execute(sql`INSERT INTO partner_categories (name, active, sort) SELECT ${clean}, active, sort FROM partner_categories WHERE name = ${from}`);
    await t.execute(sql`UPDATE partners SET category = ${clean}, updated_at = now() WHERE category = ${from}`);
    await t.execute(sql`DELETE FROM partner_categories WHERE name = ${from}`);
  });
}
