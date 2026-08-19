/**
 * Outreach worklists — who to call today, and why.
 *
 * The first module here that produces a *task* rather than a measurement.
 * Everything else in `lib/queries` answers "what happened"; this answers
 * "what should someone do about it", which carries an obligation the others
 * don't: a ranking that sends a store manager to phone the wrong 50 people
 * wastes real hours, so the score has to be inspectable and the exclusions
 * have to be honest.
 *
 * ── Two lists, because the two opportunities are different sizes ────────────
 * `reactivation` — 67,400 people carry real purchase history in
 * `loyalty_customers` and bought nothing in the loaded sales window. 8,722 of
 * them have 3+ prior bills averaging ₹92,694 lifetime. Only 602 dormant
 * customers came back on their own.
 *
 * `second_visit` — 73% of all second visits happen within 14 days of the
 * first (217 of 298 measured gaps), and the tail is thin after 28 days. So a
 * buyer who came once, 7–14 days ago, is inside a narrow window that closes
 * quietly. 2,963 buyers have exactly one visit; 312 of them spent ₹50,000+.
 *
 * ── The scores are a hypothesis, and are labelled as one ────────────────────
 * Both scores are 0–100 and both are built from percentile ranks within the
 * eligible pool rather than absolute thresholds, so they self-normalise as
 * the data grows and never need a magic rupee constant retuned by hand. The
 * *weights*, though, are a guess: nobody has yet observed whether a
 * high-scoring dormant customer actually converts better than a low-scoring
 * one. That is exactly why `outreach_contacts.score_at_contact` freezes the
 * score at contact time — after a few hundred logged outcomes the weights
 * below can be checked against reality instead of defended from intuition.
 * Every row therefore returns its `components`, so the UI can show what
 * produced the number rather than presenting a bare rank.
 *
 * ── Recency is measured from today, unlike everywhere else in this codebase ─
 * `buyers.ts` deliberately measures recency from `MAX(billed_at)`, because a
 * customer shouldn't appear to age just because nobody ran an import. That
 * reasoning inverts here. This list drives a phone call *today*, and what
 * decides whether someone has had time to come back is elapsed wall-clock
 * time, not how fresh the export is. The cost is real and is surfaced rather
 * than hidden: anyone who returned to the store after the last loaded bill is
 * invisible to this query and can still appear on the list. `dataThrough` and
 * `dataAgeDays` are returned so the page can warn about exactly that, and the
 * staler the file the louder that warning should be.
 *
 * ── Suppression is derived, never stored ───────────────────────────────────
 * "Contacted recently" is computed from `outreach_contacts` on every read
 * (D-40's append-only reasoning). There is no `last_contacted` column to fall
 * out of sync, and changing the cool-off window is a query parameter rather
 * than a backfill.
 */

import { db } from '@/db';
import { sql, type SQL } from 'drizzle-orm';
import { parseStoreParam } from './dashboard';

type Row = Record<string, unknown>;

async function query(statement: SQL): Promise<Row[]> {
  const result = (await db.execute(statement)) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export type ListKind = 'reactivation' | 'second_visit';

/** Days before a contacted person may resurface. Different per list because the windows differ. */
export const COOLOFF_DAYS: Record<ListKind, number> = {
  // A dormant customer who said "not now" is not worth re-phoning next week.
  reactivation: 90,
  // The second-visit window itself is only ~30 days wide; a 90-day cool-off
  // would mean nobody is ever contacted twice inside it, which is the point.
  second_visit: 30,
};

/** One weighted input to a score, carried through to the UI so the number is never a black box. */
export interface ScoreComponent {
  label: string;
  /** This component's contribution in points, already weighted. */
  points: number;
  /** The underlying fact, formatted by the caller. */
  detail: string;
}

/** Contact history for a person, folded onto every worklist row. */
export interface ContactState {
  contactCount: number;
  lastContactedAt: string | null;
  lastOutcome: string | null;
}

export interface ReactivationRow extends ContactState {
  customerId: number;
  fullName: string | null;
  phoneE164: string;
  score: number;
  components: ScoreComponent[];
  priorBills: number;
  priorAmount: number;
  firstBillDate: string | null;
  lastBillDate: string | null;
  daysDormant: number;
  registeredStore: string | null;
  loyaltyType: string | null;
}

export interface SecondVisitRow extends ContactState {
  customerId: number;
  fullName: string | null;
  phoneE164: string;
  score: number;
  components: ScoreComponent[];
  visitSpend: number;
  units: number;
  visitDate: string;
  daysSince: number;
  storeName: string | null;
  salesmanCode: string | null;
}

export interface WorklistMeta {
  /** Rows matching the filters, before pagination. */
  total: number;
  /** Eligible pool before the cool-off suppression — the difference is what outreach has already covered. */
  poolBeforeSuppression: number;
  dataThrough: string | null;
  dataAgeDays: number | null;
}

/**
 * Contact history per customer, as a CTE. `last_outcome` is the most recent
 * attempt's outcome specifically, not an aggregate — "we called twice and the
 * second time they said not interested" must not read as still-pending.
 */
const CONTACT_CTE = `
  contact_state AS (
    SELECT DISTINCT ON (oc.customer_id)
           oc.customer_id,
           oc.outcome::text                                        AS last_outcome,
           oc.contacted_at                                         AS last_contacted_at,
           COUNT(*) OVER (PARTITION BY oc.customer_id)::int        AS contact_count
    FROM   outreach_contacts oc
    ORDER  BY oc.customer_id, oc.contacted_at DESC
  )`;

/** `MAX(billed_at)` and how stale it is — the honesty banner's inputs. */
async function getDataFreshness(): Promise<{ dataThrough: string | null; dataAgeDays: number | null }> {
  const [row] = await query(sql`
    SELECT MAX(billed_at) AS data_through,
           EXTRACT(DAY FROM (now() - MAX(billed_at)))::int AS age_days
    FROM   sales`);
  return {
    dataThrough: row?.data_through ? new Date(row.data_through as string).toISOString() : null,
    dataAgeDays: row?.age_days === null || row?.age_days === undefined ? null : num(row.age_days),
  };
}

export interface WorklistFilters {
  q?: string;
  /** Store code, matched against the buyer's branch (second-visit) — reactivation has no reliable store. */
  store?: string;
  /** Minimum score, 0–100. */
  minScore?: number;
  /** Include people already contacted inside the cool-off window. */
  includeContacted?: boolean;
  page?: number;
  pageSize?: number;
}

function paging(filters: WorklistFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filters.pageSize ?? 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// ── Reactivation ─────────────────────────────────────────────────────────────

/**
 * Dormant customers with provable purchase history, ranked by what they were
 * worth and how recently they were worth it.
 *
 * Weights: lifetime value 50, frequency 25, recency 25. Value dominates
 * because the spread is enormous (the 3+-bill dormant segment averages
 * ₹92,694 against a ₹20,852 current AOV) and because a bigger past basket is
 * the least ambiguous evidence of what someone will spend if they return.
 * Recency is capped at a quarter of the score deliberately: `last_bill_date`
 * only reaches October 2023 in this export, so *everyone* here is stale and
 * over-weighting it would just sort the list by how recently the loyalty file
 * was cut.
 *
 * Excluded: anyone with a bill in `sales` (they aren't dormant), foreign
 * numbers (D-21 — unreachable by a local store's phone), rows with no
 * `last_bill_date` to rank on, and anyone contacted inside the cool-off.
 */
export async function getReactivationList(
  filters: WorklistFilters = {},
): Promise<{ rows: ReactivationRow[]; meta: WorklistMeta }> {
  const { pageSize, offset } = paging(filters);
  const cooloff = COOLOFF_DAYS.reactivation;

  const conditions: SQL[] = [];
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    conditions.push(sql`(s.full_name ILIKE ${term} OR s.phone_national LIKE ${term})`);
  }
  if (filters.minScore) conditions.push(sql`s.score >= ${filters.minScore}`);
  if (!filters.includeContacted) {
    conditions.push(
      sql`(s.last_contacted_at IS NULL OR s.last_contacted_at < now() - ${sql.raw(`INTERVAL '${cooloff} days'`)})`,
    );
  }
  const where = conditions.length
    ? sql.join([sql` AND `, sql.join(conditions, sql` AND `)])
    : sql``;

  const cte = sql.raw(`
  WITH ${CONTACT_CTE},
  bought AS (
    SELECT DISTINCT customer_id FROM sales WHERE customer_id IS NOT NULL
  ),
  pool AS (
    SELECT l.customer_id, c.full_name, c.phone_national, c.phone_e164,
           COALESCE(l.total_bill_count, 0)::int      AS prior_bills,
           COALESCE(l.total_bill_amount, 0)::numeric AS prior_amount,
           l.first_bill_date, l.last_bill_date,
           l.registered_store_name, l.loyalty_type
    FROM   loyalty_customers l
    JOIN   customers c ON c.id = l.customer_id
    LEFT   JOIN bought b ON b.customer_id = l.customer_id
    WHERE  COALESCE(l.total_bill_count, 0) > 0
      AND  b.customer_id IS NULL
      AND  NOT c.is_foreign
      AND  l.last_bill_date IS NOT NULL
  ),
  ranked AS (
    SELECT p.*,
           PERCENT_RANK() OVER (ORDER BY p.prior_amount)    AS v_pct,
           PERCENT_RANK() OVER (ORDER BY p.prior_bills)     AS f_pct,
           PERCENT_RANK() OVER (ORDER BY p.last_bill_date)  AS r_pct
    FROM   pool p
  ),
  scored AS (
    SELECT r.*,
           ROUND((50 * r.v_pct + 25 * r.f_pct + 25 * r.r_pct)::numeric, 1) AS score,
           ROUND((50 * r.v_pct)::numeric, 1) AS pts_value,
           ROUND((25 * r.f_pct)::numeric, 1) AS pts_freq,
           ROUND((25 * r.r_pct)::numeric, 1) AS pts_recency,
           (CURRENT_DATE - r.last_bill_date)::int AS days_dormant,
           cs.last_outcome, cs.last_contacted_at, COALESCE(cs.contact_count, 0) AS contact_count
    FROM   ranked r
    LEFT   JOIN contact_state cs ON cs.customer_id = r.customer_id
  )`);

  const [counts] = await query(sql`
    ${cte}
    SELECT (SELECT COUNT(*)::int FROM pool) AS pool_total,
           COUNT(*)::int AS total
    FROM   scored s WHERE TRUE${where}`);

  const rows = await query(sql`
    ${cte}
    SELECT s.* FROM scored s WHERE TRUE${where}
    ORDER  BY s.score DESC, s.prior_amount DESC, s.customer_id
    LIMIT  ${pageSize} OFFSET ${offset}`);

  const freshness = await getDataFreshness();

  return {
    rows: rows.map((r) => ({
      customerId: num(r.customer_id),
      fullName: str(r.full_name),
      phoneE164: String(r.phone_e164),
      score: num(r.score),
      components: [
        {
          label: 'Lifetime value',
          points: num(r.pts_value),
          detail: `${num(r.prior_amount) > 0 ? '₹' : ''}${num(r.prior_amount).toLocaleString('en-IN')} across past bills`,
        },
        { label: 'Frequency', points: num(r.pts_freq), detail: `${num(r.prior_bills)} prior bills` },
        {
          label: 'Recency',
          points: num(r.pts_recency),
          detail: `last bought ${num(r.days_dormant)} days ago`,
        },
      ],
      priorBills: num(r.prior_bills),
      priorAmount: num(r.prior_amount),
      firstBillDate: str(r.first_bill_date),
      lastBillDate: str(r.last_bill_date),
      daysDormant: num(r.days_dormant),
      registeredStore: str(r.registered_store_name),
      loyaltyType: str(r.loyalty_type),
      contactCount: num(r.contact_count),
      lastContactedAt: r.last_contacted_at
        ? new Date(r.last_contacted_at as string).toISOString()
        : null,
      lastOutcome: str(r.last_outcome),
    })),
    meta: {
      total: num(counts?.total),
      poolBeforeSuppression: num(counts?.pool_total),
      ...freshness,
    },
  };
}

// ── Second visit ─────────────────────────────────────────────────────────────

/**
 * Buyers with exactly one visit, inside the window where a second one is
 * still plausible.
 *
 * Weights: spend 60, urgency 40. Urgency is a step function on days since the
 * visit rather than a smooth decay, because the measured distribution is not
 * smooth — it is a spike inside two weeks and a long thin tail. Encoding that
 * as a curve would imply a precision the 298 observed gaps don't support:
 *
 *   3–6 days   0.6  still likely to return unprompted; a call this early is
 *                   as likely to annoy as to help
 *   7–14 days  1.0  the peak — 73% of all second visits land here
 *   15–21 days 0.6  the window is closing
 *   22–30 days 0.3  last realistic chance
 *
 * Under 3 days and over 30 are excluded outright rather than scored near
 * zero: a list is a list of people to phone, and padding it with names nobody
 * should call teaches the user to ignore the ordering.
 */
export async function getSecondVisitList(
  filters: WorklistFilters = {},
): Promise<{ rows: SecondVisitRow[]; meta: WorklistMeta }> {
  const { pageSize, offset } = paging(filters);
  const cooloff = COOLOFF_DAYS.second_visit;
  const store = parseStoreParam(filters.store);

  const conditions: SQL[] = [];
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    conditions.push(sql`(s.full_name ILIKE ${term} OR s.phone_national LIKE ${term})`);
  }
  if (filters.minScore) conditions.push(sql`s.score >= ${filters.minScore}`);
  if (store) conditions.push(sql`s.store_code = ${store}`);
  if (!filters.includeContacted) {
    conditions.push(
      sql`(s.last_contacted_at IS NULL OR s.last_contacted_at < now() - ${sql.raw(`INTERVAL '${cooloff} days'`)})`,
    );
  }
  const where = conditions.length
    ? sql.join([sql` AND `, sql.join(conditions, sql` AND `)])
    : sql``;

  const cte = sql.raw(`
  WITH ${CONTACT_CTE},
  agg AS (
    SELECT s.customer_id,
           COUNT(DISTINCT (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date)::int AS visits,
           SUM(s.bill_amount)::numeric                                          AS spend,
           COALESCE(SUM(s.qty), 0)::int                                         AS units,
           MAX(s.billed_at)                                                     AS last_billed_at
    FROM   sales s
    WHERE  s.customer_id IS NOT NULL
    GROUP  BY s.customer_id
    HAVING COUNT(DISTINCT (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date) = 1
  ),
  visit AS (
    SELECT DISTINCT ON (a.customer_id)
           a.customer_id, a.spend, a.units, a.last_billed_at,
           st.name AS store_name, st.code AS store_code, sa.salesman_code,
           (a.last_billed_at AT TIME ZONE 'Asia/Kolkata')::date AS visit_date,
           (CURRENT_DATE - (a.last_billed_at AT TIME ZONE 'Asia/Kolkata')::date)::int AS days_since
    FROM   agg a
    JOIN   sales sa ON sa.customer_id = a.customer_id
    JOIN   stores st ON st.id = sa.store_id
    ORDER  BY a.customer_id, sa.bill_amount DESC
  ),
  pool AS (
    SELECT v.*, c.full_name, c.phone_national, c.phone_e164
    FROM   visit v
    JOIN   customers c ON c.id = v.customer_id
    WHERE  v.days_since BETWEEN 3 AND 30
      AND  NOT c.is_foreign
  ),
  ranked AS (
    SELECT p.*,
           PERCENT_RANK() OVER (ORDER BY p.spend) AS s_pct,
           (CASE
              WHEN p.days_since BETWEEN 7 AND 14  THEN 1.0
              WHEN p.days_since BETWEEN 3 AND 6   THEN 0.6
              WHEN p.days_since BETWEEN 15 AND 21 THEN 0.6
              ELSE 0.3
            END)::numeric AS urgency
    FROM   pool p
  ),
  scored AS (
    SELECT r.*,
           ROUND((60 * r.s_pct + 40 * r.urgency)::numeric, 1) AS score,
           ROUND((60 * r.s_pct)::numeric, 1)                  AS pts_spend,
           ROUND((40 * r.urgency)::numeric, 1)                AS pts_urgency,
           cs.last_outcome, cs.last_contacted_at, COALESCE(cs.contact_count, 0) AS contact_count
    FROM   ranked r
    LEFT   JOIN contact_state cs ON cs.customer_id = r.customer_id
  )`);

  const [counts] = await query(sql`
    ${cte}
    SELECT (SELECT COUNT(*)::int FROM pool) AS pool_total,
           COUNT(*)::int AS total
    FROM   scored s WHERE TRUE${where}`);

  const rows = await query(sql`
    ${cte}
    SELECT s.* FROM scored s WHERE TRUE${where}
    ORDER  BY s.score DESC, s.spend DESC, s.customer_id
    LIMIT  ${pageSize} OFFSET ${offset}`);

  const freshness = await getDataFreshness();

  return {
    rows: rows.map((r) => ({
      customerId: num(r.customer_id),
      fullName: str(r.full_name),
      phoneE164: String(r.phone_e164),
      score: num(r.score),
      components: [
        {
          label: 'Visit value',
          points: num(r.pts_spend),
          detail: `₹${num(r.spend).toLocaleString('en-IN')} on their only visit`,
        },
        {
          label: 'Timing',
          points: num(r.pts_urgency),
          detail: `${num(r.days_since)} days ago${num(r.days_since) >= 7 && num(r.days_since) <= 14 ? ' — peak window' : ''}`,
        },
      ],
      visitSpend: num(r.spend),
      units: num(r.units),
      visitDate: String(r.visit_date),
      daysSince: num(r.days_since),
      storeName: str(r.store_name),
      salesmanCode: str(r.salesman_code),
      contactCount: num(r.contact_count),
      lastContactedAt: r.last_contacted_at
        ? new Date(r.last_contacted_at as string).toISOString()
        : null,
      lastOutcome: str(r.last_outcome),
    })),
    meta: {
      total: num(counts?.total),
      poolBeforeSuppression: num(counts?.pool_total),
      ...freshness,
    },
  };
}

// ── Write path ───────────────────────────────────────────────────────────────

export const OUTCOMES = [
  'coming',
  'not_connected',
  'not_available',
  'busy',
  'not_interested',
  'wrong_number',
  'other',
  'pending',
] as const;

export type Outcome = (typeof OUTCOMES)[number];

export function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

/**
 * Log one contact attempt. Always an INSERT — correcting a mistyped outcome
 * means logging the correction, not editing history out of it (D-40).
 * `score` is whatever the row displayed when the caller acted on it; passing
 * the freshly-recomputed value instead would defeat the point of storing it.
 */
export async function recordContact(input: {
  customerId: number;
  listKind: ListKind;
  outcome: Outcome;
  note?: string | null;
  score?: number | null;
  userId: string;
}): Promise<{ id: number }> {
  const [row] = await query(sql`
    INSERT INTO outreach_contacts
      (customer_id, list_kind, outcome, note, contacted_by, score_at_contact)
    VALUES
      (${input.customerId}, ${input.listKind}::outreach_list, ${input.outcome}::remark_status,
       ${input.note ?? null}, ${input.userId}, ${input.score ?? null})
    RETURNING id`);
  return { id: num(row?.id) };
}

export interface OutreachSummary {
  logged: number;
  byOutcome: { outcome: string; count: number }[];
  /** Contacted people who subsequently placed a bill — the only number that judges the lists. */
  convertedAfterContact: number;
}

/**
 * What outreach has actually produced. `convertedAfterContact` requires a bill
 * dated *after* the contact, so it cannot be inflated by the purchase that put
 * someone on the second-visit list in the first place.
 */
export async function getOutreachSummary(): Promise<OutreachSummary> {
  const [total] = await query(sql`SELECT COUNT(*)::int AS logged FROM outreach_contacts`);
  const byOutcome = await query(sql`
    SELECT outcome::text AS outcome, COUNT(*)::int AS count
    FROM   outreach_contacts GROUP BY 1 ORDER BY 2 DESC`);
  const [converted] = await query(sql`
    SELECT COUNT(DISTINCT oc.customer_id)::int AS n
    FROM   outreach_contacts oc
    JOIN   sales s ON s.customer_id = oc.customer_id AND s.billed_at > oc.contacted_at`);

  return {
    logged: num(total?.logged),
    byOutcome: byOutcome.map((r) => ({ outcome: String(r.outcome), count: num(r.count) })),
    convertedAfterContact: num(converted?.n),
  };
}
