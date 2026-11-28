-- Ananta Partner Network: program rules v1.0, phases 2–4 (on 0047's rules, levels and reviews).
--   Phase 2  monthly settlement statements, the eight approval statuses, payments (never twice), TDS, balances carried
--            forward, adjustments for returns after settlement, and per-entity expense allocation.
--   Phase 3  referral attribution controls: bills claimed by several parties go on hold until resolved (or shared),
--            retrospective attribution with management approval, and fraud flags that hold a bill for review.
--   Phase 4  campaigns (own rate, priority, what they count towards), commission exclusions, influencer
--            collaborations within the level's fee limit, additional incentives, personal shopping with the annual limit.
--
-- Everything is calculated here, in the database, so a page load, a test and a statement all apply the same rules.
-- History is never overwritten: a settled month is frozen; later changes become adjustment rows.
--
-- Not possible with the data the CRM has (bills carry totals, not items): product/category/collection eligibility and
-- the contribution-margin check. Bills are excluded by store, by invoice or through a campaign instead.

-- ── Rule terms: settlement, referral and review settings ─────────────────────
-- Added to every version without changing its levels; a later version can change them like any other term.
--   tdsPercent / tdsAnnualThreshold   TDS on commission (s.194H): rate, and the financial-year total above which it applies
--   minPayout                         a statement below this carries forward instead of being paid
--   verifyByDay / approveByDay / payByDay   the settlement calendar (days of the following month)
--   largeBillFlag                     a single referred bill at or above this is flagged for review
--   existingCustomers                 whether existing customers can be referred (verified before they earn)
UPDATE partner_rule_versions SET terms = '{"tdsPercent":2,"tdsAnnualThreshold":20000,"minPayout":0,"verifyByDay":5,"approveByDay":10,"payByDay":15,"largeBillFlag":500000,"existingCustomers":true}'::jsonb || terms;

CREATE OR REPLACE FUNCTION partner_term(p_month text, p_key text, p_default numeric) RETURNS numeric
LANGUAGE sql STABLE AS $$ SELECT COALESCE(((partner_rules_for(p_month)).terms ->> p_key)::numeric, p_default) $$;

-- ── Entities: which legal entity each store's sales belong to (expense allocation) ──
CREATE TABLE IF NOT EXISTS partner_entities (
  store_code text PRIMARY KEY,
  entity text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO partner_entities (store_code, entity) VALUES ('MG_ROAD', 'Deepam by Ananta'), ('JAYANAGAR', 'Deepam by Ananta')
ON CONFLICT (store_code) DO NOTHING;
CREATE OR REPLACE FUNCTION partner_entity_of(p_store text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT COALESCE((SELECT entity FROM partner_entities WHERE store_code = p_store), 'Deepam by Ananta') $$;

-- ── Campaigns ─────────────────────────────────────────────────────────────────
-- A campaign's rate replaces the standard rate on its bills (dates and stores; no stores = every store). Where two
-- campaigns cover a bill, the lower priority number wins, so one rule applies per bill. Draft until approved.
CREATE TABLE IF NOT EXISTS partner_campaigns (
  id serial PRIMARY KEY,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  store_codes text[] NOT NULL DEFAULT '{}',
  excluded_invoices text[] NOT NULL DEFAULT '{}',
  commission_percent numeric(5, 2) NOT NULL CHECK (commission_percent >= 0 AND commission_percent <= 100),
  priority integer NOT NULL DEFAULT 100,
  counts_toward_level boolean NOT NULL DEFAULT true,   -- counts towards the monthly slab and the partnership level review
  bonus_eligible boolean NOT NULL DEFAULT true,         -- counts towards the monthly bonus
  personal_discount_allowed boolean NOT NULL DEFAULT false,
  min_margin_percent numeric(5, 2),                     -- recorded; checked once item costs reach the CRM
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  notes text,
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

-- ── Exclusions: bills that earn no commission (announced before the sale) ─────
CREATE TABLE IF NOT EXISTS partner_exclusions (
  id serial PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('store', 'invoice')),
  value text NOT NULL,
  from_on date NOT NULL,
  to_on date,
  reason text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Commission lines: campaign, hold, exclusion, share, retrospective ────────
ALTER TABLE partner_commissions ADD COLUMN IF NOT EXISTS campaign_id integer REFERENCES partner_campaigns (id);
ALTER TABLE partner_commissions ADD COLUMN IF NOT EXISTS on_hold boolean NOT NULL DEFAULT false;
ALTER TABLE partner_commissions ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false;
ALTER TABLE partner_commissions ADD COLUMN IF NOT EXISTS share_percent numeric(5, 2);
ALTER TABLE partner_commissions ADD COLUMN IF NOT EXISTS retro boolean NOT NULL DEFAULT false;
ALTER TABLE partner_commissions ADD COLUMN IF NOT EXISTS retro_reason text;
ALTER TABLE partner_commissions ADD COLUMN IF NOT EXISTS retro_requested_by text;
ALTER TABLE partner_commissions ADD COLUMN IF NOT EXISTS retro_approved_by text;

-- ── Claims: the same bill claimed by more than one party ─────────────────────
-- An open claim holds the partner's line. Resolution: the partner keeps it, another party gets it (the line earns
-- nothing), or it is shared (the partner's share of the line's commission; the shares together never exceed 100%).
CREATE TABLE IF NOT EXISTS partner_claims (
  id serial PRIMARY KEY,
  voucher_no text NOT NULL,
  claimant_type text NOT NULL CHECK (claimant_type IN ('partner', 'driver', 'travel_agent', 'affiliate', 'other')),
  claimant_name text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution text CHECK (resolution IN ('partner', 'other', 'shared')),
  partner_share_percent numeric(5, 2) CHECK (partner_share_percent > 0 AND partner_share_percent < 100),
  other_share_amount numeric(12, 2),
  resolved_by text,
  resolved_reason text,
  resolved_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR (resolution IS NOT NULL AND resolved_by IS NOT NULL)),
  CHECK (resolution IS DISTINCT FROM 'shared' OR partner_share_percent IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS partner_claims_voucher_idx ON partner_claims (voucher_no);

-- ── Fraud flags ───────────────────────────────────────────────────────────────
-- Raised by partner_detect_flags() or by staff. An open flag on a bill holds it; confirmed fraud excludes it;
-- cleared lets it earn. Never deleted.
CREATE TABLE IF NOT EXISTS partner_flags (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  partner_id integer REFERENCES partners (id),
  voucher_no text,
  referral_id bigint REFERENCES partner_referrals (id),
  detail text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cleared', 'confirmed')),
  resolved_by text,
  resolved_reason text,
  resolved_at timestamptz,
  created_by text NOT NULL DEFAULT 'System',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_flags_uidx ON partner_flags (kind, COALESCE(partner_id, 0), COALESCE(voucher_no, ''), COALESCE(referral_id, 0));

-- ── Personal shopping ─────────────────────────────────────────────────────────
-- A partner's own purchase at their level's discount, up to the annual limit (calendar year, all stores), recorded
-- with its bill. It earns no commission and does not count towards levels. Returns give the limit back.
CREATE TABLE IF NOT EXISTS partner_personal_purchases (
  id serial PRIMARY KEY,
  partner_id integer NOT NULL REFERENCES partners (id),
  voucher_no text NOT NULL UNIQUE,
  purchase_on date NOT NULL,
  year integer NOT NULL,
  purchase_value numeric(12, 2) NOT NULL CHECK (purchase_value > 0),   -- before the partner discount, before GST
  partnership_level integer NOT NULL,
  discount_percent numeric(5, 2) NOT NULL,
  eligible_value numeric(12, 2) NOT NULL,                             -- the part inside the remaining annual limit
  discount_amount numeric(12, 2) NOT NULL,
  otp_verified boolean NOT NULL,
  note text,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_personal_purchases_idx ON partner_personal_purchases (partner_id, year);

-- ── Influencer collaborations ─────────────────────────────────────────────────
-- Approved by management against the limit of the partner's previous completed month's commission level (an
-- exception needs a reason); payable once completed, in the settlement of the month it was completed.
CREATE TABLE IF NOT EXISTS partner_collaborations (
  id serial PRIMARY KEY,
  partner_id integer NOT NULL REFERENCES partners (id),
  entity text NOT NULL,
  title text NOT NULL,
  deliverables text NOT NULL,
  due_on date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'paid')),
  approval_month text,
  limit_at_approval numeric(12, 2),
  exception_reason text,
  requested_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  rejected_reason text,
  completed_by text,
  completed_at timestamptz,
  settlement_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Additional incentives ─────────────────────────────────────────────────────
--   first_sale     the partner's first month with eligible sales
--   monthly_sales  a month's qualifying sales at least min_sales
--   consistency    `months` months in a row each at least min_sales (awarded once per run of that length)
--   manual         awarded by staff
-- Draft until approved and activated. A total payout cap stops awards once reached.
CREATE TABLE IF NOT EXISTS partner_incentives (
  id serial PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('first_sale', 'monthly_sales', 'consistency', 'manual')),
  min_sales numeric(14, 2) NOT NULL DEFAULT 0,
  months integer NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 12),
  categories text[] NOT NULL DEFAULT '{}',
  levels integer[] NOT NULL DEFAULT '{}',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  reward numeric(12, 2) NOT NULL CHECK (reward > 0),
  max_payout numeric(14, 2),
  entity text,
  reverse_on_return boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  notes text,
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE TABLE IF NOT EXISTS partner_incentive_awards (
  id serial PRIMARY KEY,
  incentive_id integer NOT NULL REFERENCES partner_incentives (id),
  partner_id integer NOT NULL REFERENCES partners (id),
  month text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  auto boolean NOT NULL DEFAULT true,
  note text,
  awarded_by text NOT NULL DEFAULT 'System',
  settlement_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incentive_id, partner_id, month)
);

-- ── Months: the parts of the commission ───────────────────────────────────────
ALTER TABLE partner_months ADD COLUMN IF NOT EXISTS threshold_sales numeric(14, 2);
ALTER TABLE partner_months ADD COLUMN IF NOT EXISTS bonus_sales numeric(14, 2);
ALTER TABLE partner_months ADD COLUMN IF NOT EXISTS standard_commission numeric(12, 2);
ALTER TABLE partner_months ADD COLUMN IF NOT EXISTS campaign_commission numeric(12, 2);
ALTER TABLE partner_months ADD COLUMN IF NOT EXISTS commission_by_store jsonb;
ALTER TABLE partner_months ADD COLUMN IF NOT EXISTS bonus_by_store jsonb;
ALTER TABLE partner_months ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- ── Settlements ───────────────────────────────────────────────────────────────
--   pending_verification  being worked out (numbers move with sales, returns and holds)
--   pending_approval      verified by accounts, waiting for management
--   verified              verified, nothing to pay (zero, negative or below the minimum payout): carried forward
--   approved              approved by management, to pay
--   on_hold               stopped (with a reason); released back to where it was
--   partially_paid / paid
--   adjusted              settled, and a later adjustment for its month was recorded (its own numbers never change)
CREATE TABLE IF NOT EXISTS partner_settlements (
  id serial PRIMARY KEY,
  partner_id integer NOT NULL REFERENCES partners (id),
  month text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text NOT NULL DEFAULT 'pending_verification' CHECK (status IN
    ('pending_verification', 'pending_approval', 'verified', 'approved', 'on_hold', 'partially_paid', 'paid', 'adjusted')),
  rule_version_id integer REFERENCES partner_rule_versions (id),
  opening_balance numeric(12, 2) NOT NULL DEFAULT 0,
  eligible_sales numeric(14, 2) NOT NULL DEFAULT 0,
  threshold_sales numeric(14, 2) NOT NULL DEFAULT 0,
  by_store jsonb NOT NULL DEFAULT '{}'::jsonb,
  commission_level integer,
  commission_percent numeric(5, 2),
  standard_commission numeric(12, 2) NOT NULL DEFAULT 0,
  campaign_commission numeric(12, 2) NOT NULL DEFAULT 0,
  bonus numeric(12, 2) NOT NULL DEFAULT 0,
  collab_fees numeric(12, 2) NOT NULL DEFAULT 0,
  incentives numeric(12, 2) NOT NULL DEFAULT 0,
  adjustments numeric(12, 2) NOT NULL DEFAULT 0,
  gross numeric(12, 2) NOT NULL DEFAULT 0,
  tds_base numeric(12, 2) NOT NULL DEFAULT 0,
  tds_percent numeric(5, 2) NOT NULL DEFAULT 0,
  tds numeric(12, 2) NOT NULL DEFAULT 0,
  net_payable numeric(12, 2) NOT NULL DEFAULT 0,
  paid_amount numeric(12, 2) NOT NULL DEFAULT 0,
  closing_balance numeric(12, 2) NOT NULL DEFAULT 0,
  held_lines integer NOT NULL DEFAULT 0,
  allocation jsonb NOT NULL DEFAULT '{}'::jsonb,
  statement jsonb,
  verified_by text,
  verified_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  hold_reason text,
  hold_from text,
  held_by text,
  adjusted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, month)
);
CREATE TABLE IF NOT EXISTS partner_settlement_payments (
  id serial PRIMARY KEY,
  settlement_id integer NOT NULL REFERENCES partner_settlements (id),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL,
  reference text NOT NULL,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One payment reference is used once, anywhere: the same UTR can't pay two statements (or one twice).
CREATE UNIQUE INDEX IF NOT EXISTS partner_settlement_payments_ref_uidx ON partner_settlement_payments (upper(regexp_replace(reference, '\s', '', 'g')));

-- Adjustments: 'recalc' (a settled month recalculated after returns, holds or claims) or 'manual' (with approval).
-- Applied to the partner's next statement; the original statement is never changed.
CREATE TABLE IF NOT EXISTS partner_adjustments (
  id serial PRIMARY KEY,
  partner_id integer NOT NULL REFERENCES partners (id),
  kind text NOT NULL CHECK (kind IN ('recalc', 'manual')),
  month text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount <> 0),
  reason text NOT NULL,
  original_settlement_id integer REFERENCES partner_settlements (id),
  rule_version_id integer REFERENCES partner_rule_versions (id),
  created_by text NOT NULL DEFAULT 'System',
  approved_by text,
  applied_settlement_id integer REFERENCES partner_settlements (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_adjustments_partner_idx ON partner_adjustments (partner_id, applied_settlement_id);

INSERT INTO settings (key, value, description) VALUES
  ('partner_settlements_from', '"2026-11"', 'Partner Network: the first month with a settlement statement.')
ON CONFLICT (key) DO NOTHING;

-- ── Referral matching: retrospective lines stay ───────────────────────────────
-- Same as 0039, except a line attached retrospectively (approved by management) is never dropped for falling outside
-- the referral's window.
CREATE OR REPLACE FUNCTION partner_refresh_referrals(p_phone text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  UPDATE partner_referrals r SET customer_id = c.id, updated_at = now()
  FROM customers c
  WHERE r.customer_id IS NULL AND r.status <> 'declined' AND c.phone_e164 = r.phone_e164
    AND (p_phone IS NULL OR r.phone_e164 = p_phone);

  DELETE FROM partner_commissions pc
  USING partner_referrals r
  WHERE pc.referral_id = r.id AND pc.status = 'pending' AND NOT pc.retro AND (p_phone IS NULL OR r.phone_e164 = p_phone)
    AND NOT EXISTS (
      SELECT 1 FROM sales s JOIN customers c ON c.id = s.customer_id
      WHERE s.voucher_no = pc.voucher_no AND s.bill_amount > 0
        AND (c.id = r.customer_id OR c.phone_e164 = r.phone_e164)
        AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN r.registered_on AND r.window_ends_on
    );

  UPDATE partner_commissions pc SET bill_amount = s.bill_amount, billed_at = s.billed_at, store_id = s.store_id
  FROM sales s, partner_referrals r
  WHERE pc.status = 'pending' AND s.voucher_no = pc.voucher_no AND r.id = pc.referral_id
    AND (p_phone IS NULL OR r.phone_e164 = p_phone)
    AND (pc.bill_amount, pc.billed_at, pc.store_id) IS DISTINCT FROM (s.bill_amount, s.billed_at, s.store_id);

  INSERT INTO partner_commissions (referral_id, partner_id, voucher_no, store_id, billed_at, bill_amount)
  SELECT DISTINCT ON (s.voucher_no) r.id, r.partner_id, s.voucher_no, s.store_id, s.billed_at, s.bill_amount
  FROM partner_referrals r
  JOIN customers c ON c.id = r.customer_id OR c.phone_e164 = r.phone_e164
  JOIN sales s ON s.customer_id = c.id
  WHERE r.status <> 'declined' AND s.bill_amount > 0
    AND (p_phone IS NULL OR r.phone_e164 = p_phone)
    AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN r.registered_on AND r.window_ends_on
  ORDER BY s.voucher_no, r.registered_at, r.id
  ON CONFLICT (voucher_no) DO NOTHING;

  UPDATE partner_referrals r SET status = n.status, converted_at = n.converted_at, updated_at = now()
  FROM (
    SELECT r2.id,
      CASE WHEN f.first_bill IS NOT NULL THEN 'converted' WHEN r2.window_ends_on < today THEN 'expired' ELSE 'registered' END AS status,
      f.first_bill AS converted_at
    FROM partner_referrals r2
    LEFT JOIN LATERAL (
      SELECT min(pc.billed_at) AS first_bill FROM partner_commissions pc WHERE pc.referral_id = r2.id AND pc.status <> 'rejected'
    ) f ON true
    WHERE r2.status <> 'declined' AND (p_phone IS NULL OR r2.phone_e164 = p_phone)
  ) n
  WHERE r.id = n.id AND (r.status, r.converted_at) IS DISTINCT FROM (n.status, n.converted_at);
END
$$;

-- ── Fraud detection ───────────────────────────────────────────────────────────
-- Adds flags it has not raised before (a cleared flag is not raised again).
--   self_referral          the referred customer has the partner's name or email
--   duplicate_registration the number was registered by two or more partners within 90 days
--   repeated_returns       a referred customer returned two or more bills that earned commission
--   large_bill             one referred bill at or above the rules' largeBillFlag
--   personal_as_referral   a personal purchase bill also matched to a referral
--   unusual_adjustment     a manual adjustment of ₹10,000 or more either way
--   duplicate_payout       two payments of the same amount to the same partner within 3 days
CREATE OR REPLACE FUNCTION partner_detect_flags() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer := 0; k integer;
BEGIN
  INSERT INTO partner_flags (kind, partner_id, referral_id, detail)
  SELECT 'self_referral', r.partner_id, r.id, 'Referred customer "' || r.full_name || '" has the partner''s name'
  FROM partner_referrals r JOIN partners p ON p.id = r.partner_id
  WHERE r.status <> 'declined' AND lower(regexp_replace(r.full_name, '\s+', ' ', 'g')) = lower(regexp_replace(p.full_name, '\s+', ' ', 'g'))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  INSERT INTO partner_flags (kind, partner_id, referral_id, detail)
  SELECT 'duplicate_registration', r.partner_id, r.id, 'Number also registered by ' || o.partner_code || ' within 90 days'
  FROM partner_referrals r
  JOIN LATERAL (
    SELECT p2.partner_code FROM partner_referrals r2 JOIN partners p2 ON p2.id = r2.partner_id
    WHERE r2.phone_e164 = r.phone_e164 AND r2.partner_id <> r.partner_id AND r2.registered_at < r.registered_at
      AND r2.registered_at > r.registered_at - interval '90 days' LIMIT 1
  ) o ON true
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  INSERT INTO partner_flags (kind, partner_id, voucher_no, detail)
  SELECT 'repeated_returns', pc.partner_id, pc.voucher_no, 'Customer has ' || x.returns || ' returned referred bills'
  FROM partner_commissions pc JOIN sales s ON s.voucher_no = pc.voucher_no
  JOIN LATERAL (
    SELECT count(*) AS returns FROM partner_commissions pc2 JOIN sales s2 ON s2.voucher_no = pc2.voucher_no
    WHERE pc2.referral_id = pc.referral_id AND (s2.fully_returned OR s2.returned_amount > 0)
  ) x ON true
  WHERE (s.fully_returned OR s.returned_amount > 0) AND x.returns >= 2
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  INSERT INTO partner_flags (kind, partner_id, voucher_no, detail)
  SELECT 'large_bill', pc.partner_id, pc.voucher_no, 'Single bill of ₹' || to_char(pc.bill_amount, 'FM99,99,99,990') || ' (review threshold ₹' ||
    to_char(partner_term(partner_month_of(pc.billed_at), 'largeBillFlag', 500000), 'FM99,99,99,990') || ')'
  FROM partner_commissions pc
  WHERE pc.status IN ('pending', 'validated') AND pc.bill_amount >= partner_term(partner_month_of(pc.billed_at), 'largeBillFlag', 500000)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  INSERT INTO partner_flags (kind, partner_id, voucher_no, detail)
  SELECT 'personal_as_referral', pc.partner_id, pc.voucher_no, 'Recorded as the partner''s personal purchase and also matched to a referral'
  FROM partner_commissions pc JOIN partner_personal_purchases pp ON pp.voucher_no = pc.voucher_no
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  INSERT INTO partner_flags (kind, partner_id, detail, created_by)
  SELECT 'unusual_adjustment', a.partner_id, 'Manual adjustment #' || a.id || ' of ₹' || to_char(a.amount, 'FM99,99,99,990.00') || ': ' || a.reason, 'System'
  FROM partner_adjustments a WHERE a.kind = 'manual' AND abs(a.amount) >= 10000
    AND NOT EXISTS (SELECT 1 FROM partner_flags f WHERE f.kind = 'unusual_adjustment' AND f.detail LIKE 'Manual adjustment #' || a.id || ' %')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  INSERT INTO partner_flags (kind, partner_id, detail)
  SELECT DISTINCT 'duplicate_payout', s1.partner_id, 'Payments of ₹' || to_char(p1.amount, 'FM99,99,99,990.00') || ' on ' || p1.paid_on || ' and ' || p2.paid_on
  FROM partner_settlement_payments p1 JOIN partner_settlements s1 ON s1.id = p1.settlement_id
  JOIN partner_settlement_payments p2 ON p2.id > p1.id AND p2.amount = p1.amount AND abs(p2.paid_on - p1.paid_on) <= 3
  JOIN partner_settlements s2 ON s2.id = p2.settlement_id AND s2.partner_id = s1.partner_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END
$$;

-- ── Eligible lines ────────────────────────────────────────────────────────────
-- The bills that count: matched, not rejected, the referral verified if it is an existing customer, not on hold, not
-- excluded. `share` is the partner's share of the commission (100 unless a claim was shared).
CREATE OR REPLACE VIEW partner_eligible_lines AS
SELECT pc.id, pc.partner_id, partner_month_of(pc.billed_at) AS month, pc.voucher_no, pc.status, COALESCE(pc.net_amount, pc.bill_amount) AS net,
  COALESCE(st.code, '-') AS store, pc.campaign_id, c.commission_percent AS campaign_percent,
  COALESCE(c.counts_toward_level, true) AS counts, COALESCE(c.bonus_eligible, true) AS bonus_ok, COALESCE(pc.share_percent, 100) AS share
FROM partner_commissions pc
JOIN partner_referrals r ON r.id = pc.referral_id
LEFT JOIN stores st ON st.id = pc.store_id
LEFT JOIN partner_campaigns c ON c.id = pc.campaign_id
WHERE pc.status IN ('pending', 'validated', 'paid') AND r.verify_status IS DISTINCT FROM 'pending' AND NOT pc.on_hold AND NOT pc.excluded;

-- A partner's month, worked out from its eligible lines under the rules version in force that month:
--   threshold  sales that count towards the slab (campaign bills only if the campaign says so) → commission level
--   standard   the level's % on the whole month's non-campaign sales (whole month, not slab by slab)
--   campaign   each campaign bill at its campaign's %
--   bonus      the level reached by bonus-qualifying sales: its bonus (only the highest; none with no sales)
CREATE OR REPLACE FUNCTION partner_month_calc(p_partner integer, p_month text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH l AS (SELECT * FROM partner_eligible_lines WHERE partner_id = p_partner AND month = p_month),
  rv AS (SELECT * FROM partner_rules_for(p_month)),
  s AS (
    SELECT COALESCE(sum(net), 0) AS eligible,
      COALESCE(sum(net) FILTER (WHERE campaign_id IS NULL OR counts), 0) AS threshold,
      COALESCE(sum(net) FILTER (WHERE campaign_id IS NULL OR bonus_ok), 0) AS bonus_sales,
      COALESCE(sum(net * share / 100) FILTER (WHERE campaign_id IS NULL), 0) AS std_base,
      COALESCE(sum(round(net * share / 100 * campaign_percent / 100, 2)) FILTER (WHERE campaign_id IS NOT NULL), 0) AS camp,
      count(*) AS lines
    FROM l
  ),
  lv AS (SELECT partner_level_for(rv.levels, s.threshold) AS lv, partner_level_for(rv.levels, s.bonus_sales) AS bl, rv.id AS rv_id FROM rv, s),
  per AS (
    SELECT store, sum(net) AS v,
      sum(net * share / 100) FILTER (WHERE campaign_id IS NULL) AS std_base,
      sum(round(net * share / 100 * campaign_percent / 100, 2)) FILTER (WHERE campaign_id IS NOT NULL) AS camp,
      sum(net) FILTER (WHERE campaign_id IS NULL OR bonus_ok) AS bonus_v
    FROM l GROUP BY store
  )
  SELECT jsonb_build_object(
    'ruleVersionId', lv.rv_id, 'lines', s.lines, 'eligible', s.eligible, 'threshold', s.threshold, 'bonusSales', s.bonus_sales,
    'level', (lv.lv ->> 'level')::int, 'percent', (lv.lv ->> 'commissionPercent')::numeric,
    'standard', round(s.std_base * (lv.lv ->> 'commissionPercent')::numeric / 100, 2), 'campaign', s.camp,
    'bonus', CASE WHEN s.bonus_sales > 0 THEN (lv.bl ->> 'bonus')::numeric ELSE 0 END,
    'byStore', COALESCE((SELECT jsonb_object_agg(store, v) FROM per), '{}'::jsonb),
    'commissionByStore', COALESCE((SELECT jsonb_object_agg(store, round(COALESCE(std_base, 0) * (lv.lv ->> 'commissionPercent')::numeric / 100, 2) + COALESCE(camp, 0)) FROM per), '{}'::jsonb),
    'bonusByStore', COALESCE((SELECT jsonb_object_agg(store, COALESCE(bonus_v, 0)) FROM per), '{}'::jsonb))
  FROM s, lv
$$;

-- Holds, exclusions and campaigns on lines, then every unsettled month recalculated (replaces 0047's version).
CREATE OR REPLACE FUNCTION partner_refresh_months() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Net value before GST, less returns: kept current on every line (a settled month is frozen in partner_months and its
  -- statement, so a later return shows as an adjustment rather than rewriting history).
  UPDATE partner_commissions pc
  SET net_amount = partner_net_value(s.bill_amount, s.taxable_amount, s.returned_amount, s.fully_returned)
  FROM sales s
  WHERE s.voucher_no = pc.voucher_no
    AND pc.net_amount IS DISTINCT FROM partner_net_value(s.bill_amount, s.taxable_amount, s.returned_amount, s.fully_returned);
  UPDATE partner_commissions SET net_amount = bill_amount WHERE net_amount IS NULL;

  -- Campaign (lines of months not yet settled): the active campaign covering the bill's date and store with the lowest
  -- priority number, unless the invoice is excluded from it.
  UPDATE partner_commissions pc SET campaign_id = x.cid
  FROM (
    SELECT pc2.id, (
      SELECT c.id FROM partner_campaigns c LEFT JOIN stores st ON st.id = pc2.store_id
      WHERE c.status = 'active' AND (pc2.billed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN c.starts_on AND c.ends_on
        AND (cardinality(c.store_codes) = 0 OR st.code = ANY (c.store_codes)) AND NOT (pc2.voucher_no = ANY (c.excluded_invoices))
      ORDER BY c.priority, c.id LIMIT 1) AS cid
    FROM partner_commissions pc2
    WHERE pc2.status <> 'paid' AND NOT EXISTS (
      SELECT 1 FROM partner_months m WHERE m.partner_id = pc2.partner_id AND m.month = partner_month_of(pc2.billed_at) AND m.settled_at IS NOT NULL)
  ) x
  WHERE pc.id = x.id AND pc.campaign_id IS DISTINCT FROM x.cid;

  -- Exclusions and holds.
  UPDATE partner_commissions pc SET excluded = x.excluded, on_hold = x.on_hold, share_percent = x.share
  FROM (
    SELECT pc2.id,
      EXISTS (SELECT 1 FROM partner_personal_purchases pp WHERE pp.voucher_no = pc2.voucher_no)
      OR EXISTS (SELECT 1 FROM partner_exclusions e LEFT JOIN stores st ON st.id = pc2.store_id
                 WHERE (pc2.billed_at AT TIME ZONE 'Asia/Kolkata')::date >= e.from_on AND (e.to_on IS NULL OR (pc2.billed_at AT TIME ZONE 'Asia/Kolkata')::date <= e.to_on)
                   AND ((e.scope = 'invoice' AND upper(e.value) = upper(pc2.voucher_no)) OR (e.scope = 'store' AND e.value = st.code)))
      OR EXISTS (SELECT 1 FROM partner_claims c WHERE c.voucher_no = pc2.voucher_no AND c.status = 'resolved' AND c.resolution = 'other')
      OR EXISTS (SELECT 1 FROM partner_flags f WHERE f.voucher_no = pc2.voucher_no AND f.status = 'confirmed') AS excluded,
      EXISTS (SELECT 1 FROM partner_claims c WHERE c.voucher_no = pc2.voucher_no AND c.status = 'open')
      OR EXISTS (SELECT 1 FROM partner_flags f WHERE f.voucher_no = pc2.voucher_no AND f.status = 'open') AS on_hold,
      (SELECT min(c.partner_share_percent) FROM partner_claims c WHERE c.voucher_no = pc2.voucher_no AND c.status = 'resolved' AND c.resolution = 'shared') AS share
    FROM partner_commissions pc2
  ) x
  WHERE pc.id = x.id AND (pc.excluded, pc.on_hold, pc.share_percent) IS DISTINCT FROM (x.excluded, x.on_hold, x.share);

  -- Every partner-month with an eligible line (or an existing row, which drops to zero), unless settled or paid.
  WITH keys AS (
    SELECT DISTINCT partner_id, month FROM partner_eligible_lines
    UNION SELECT partner_id, month FROM partner_months
  ), calc AS (
    SELECT k.partner_id, k.month, partner_month_calc(k.partner_id, k.month) AS c FROM keys k
    WHERE NOT EXISTS (SELECT 1 FROM partner_months m WHERE m.partner_id = k.partner_id AND m.month = k.month AND (m.settled_at IS NOT NULL OR m.paid_at IS NOT NULL))
  )
  INSERT INTO partner_months AS m (partner_id, month, rule_version_id, eligible_sales, by_store, commission_level, commission_percent, commission, bonus,
    threshold_sales, bonus_sales, standard_commission, campaign_commission, commission_by_store, bonus_by_store, partnership_level, updated_at)
  SELECT c.partner_id, c.month, (c.c ->> 'ruleVersionId')::int, (c.c ->> 'eligible')::numeric, c.c -> 'byStore', (c.c ->> 'level')::int, (c.c ->> 'percent')::numeric,
    (c.c ->> 'standard')::numeric + (c.c ->> 'campaign')::numeric, (c.c ->> 'bonus')::numeric,
    (c.c ->> 'threshold')::numeric, (c.c ->> 'bonusSales')::numeric, (c.c ->> 'standard')::numeric, (c.c ->> 'campaign')::numeric,
    c.c -> 'commissionByStore', c.c -> 'bonusByStore', CASE WHEN c.month = partner_this_month() THEN p.level END, now()
  FROM calc c JOIN partners p ON p.id = c.partner_id
  ON CONFLICT (partner_id, month) DO UPDATE SET
    rule_version_id = excluded.rule_version_id, eligible_sales = excluded.eligible_sales, by_store = excluded.by_store,
    commission_level = excluded.commission_level, commission_percent = excluded.commission_percent, commission = excluded.commission, bonus = excluded.bonus,
    threshold_sales = excluded.threshold_sales, bonus_sales = excluded.bonus_sales, standard_commission = excluded.standard_commission,
    campaign_commission = excluded.campaign_commission, commission_by_store = excluded.commission_by_store, bonus_by_store = excluded.bonus_by_store,
    partnership_level = COALESCE(excluded.partnership_level, m.partnership_level), updated_at = now()
  WHERE m.settled_at IS NULL AND m.paid_at IS NULL AND (m.rule_version_id, m.eligible_sales, m.by_store, m.commission_level, m.commission_percent, m.commission, m.bonus,
      m.threshold_sales, m.bonus_sales, m.standard_commission, m.campaign_commission, m.commission_by_store, m.bonus_by_store)
    IS DISTINCT FROM (excluded.rule_version_id, excluded.eligible_sales, excluded.by_store, excluded.commission_level, excluded.commission_percent, excluded.commission, excluded.bonus,
      excluded.threshold_sales, excluded.bonus_sales, excluded.standard_commission, excluded.campaign_commission, excluded.commission_by_store, excluded.bonus_by_store);

  -- Validated lines of unsettled months: their own amount at the month's rate (or their campaign's), times their share.
  UPDATE partner_commissions pc SET
    commission_percent = m.commission_percent, level = m.commission_level, payout_month = m.month,
    commission_amount = CASE WHEN pc.on_hold OR pc.excluded THEN 0 ELSE round(pc.net_amount * COALESCE(pc.share_percent, 100) / 100 * m.commission_percent / 100, 2) END
  FROM partner_months m
  WHERE pc.status = 'validated' AND pc.campaign_id IS NULL AND m.partner_id = pc.partner_id AND m.month = partner_month_of(pc.billed_at) AND m.settled_at IS NULL;
  UPDATE partner_commissions pc SET commission_percent = c.commission_percent, level = m.commission_level, payout_month = m.month,
    commission_amount = CASE WHEN pc.on_hold OR pc.excluded THEN 0 ELSE round(pc.net_amount * COALESCE(pc.share_percent, 100) / 100 * c.commission_percent / 100, 2) END
  FROM partner_campaigns c, partner_months m
  WHERE pc.status = 'validated' AND c.id = pc.campaign_id AND m.partner_id = pc.partner_id AND m.month = partner_month_of(pc.billed_at) AND m.settled_at IS NULL;
END
$$;

-- Level reviews count only the sales that count towards levels (campaigns can opt out). Otherwise as in 0047.
CREATE OR REPLACE FUNCTION partner_run_reviews() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  m text;
  last_done text;
  from_month text := COALESCE((SELECT value #>> '{}' FROM settings WHERE key = 'partner_reviews_from'), partner_this_month());
  rv partner_rule_versions;
  p record;
  first_full text;
  window_start text;
  n_months integer;
  avg_sales numeric;
  q integer;
  streak integer;
  new_level integer;
  done integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('partner-run-reviews'));
  SELECT max(review_month) INTO last_done FROM partner_level_reviews WHERE kind = 'monthly';
  m := GREATEST(from_month, COALESCE(to_char(to_date(last_done, 'YYYY-MM') + interval '1 month', 'YYYY-MM'), from_month));
  WHILE m < partner_this_month() LOOP
    rv := partner_rules_for(m);
    FOR p IN SELECT * FROM partners WHERE status IN ('approved', 'on_hold', 'suspended') AND approved_at IS NOT NULL AND partner_month_of(approved_at) < m
             AND NOT EXISTS (SELECT 1 FROM partner_level_reviews x WHERE x.partner_id = partners.id AND x.kind = 'monthly' AND x.review_month = m)
    LOOP
      first_full := to_char(date_trunc('month', p.approved_at AT TIME ZONE 'Asia/Kolkata') + interval '1 month', 'YYYY-MM');
      window_start := GREATEST(first_full, to_char(to_date(m, 'YYYY-MM') - make_interval(months => (rv.terms ->> 'reviewMonths')::int - 1), 'YYYY-MM'));
      n_months := (EXTRACT(YEAR FROM age(to_date(m, 'YYYY-MM'), to_date(window_start, 'YYYY-MM'))) * 12
                   + EXTRACT(MONTH FROM age(to_date(m, 'YYYY-MM'), to_date(window_start, 'YYYY-MM'))))::int + 1;
      SELECT COALESCE(sum(COALESCE(threshold_sales, eligible_sales)), 0) / n_months INTO avg_sales
      FROM partner_months WHERE partner_id = p.id AND month BETWEEN window_start AND m;
      q := (partner_level_for(rv.levels, avg_sales) ->> 'level')::int;
      IF q > p.level THEN new_level := q; streak := 0;
      ELSIF q < p.level THEN
        streak := p.below_streak + 1;
        IF streak >= (rv.terms ->> 'downgradeAfter')::int THEN new_level := q; streak := 0; ELSE new_level := p.level; END IF;
      ELSE new_level := p.level; streak := 0;
      END IF;
      INSERT INTO partner_level_reviews (partner_id, kind, review_month, months_counted, average_sales, qualifying_level, previous_level, new_level, below_streak, effective_month)
      VALUES (p.id, 'monthly', m, n_months, round(avg_sales, 2), q, p.level, new_level, streak, to_char(to_date(m, 'YYYY-MM') + interval '1 month', 'YYYY-MM'));
      UPDATE partners SET level = new_level, below_streak = streak, updated_at = now() WHERE id = p.id;
      done := done + 1;
    END LOOP;
    m := to_char(to_date(m, 'YYYY-MM') + interval '1 month', 'YYYY-MM');
  END LOOP;
  RETURN done;
END
$$;

-- ── Incentives ────────────────────────────────────────────────────────────────
-- Automatic awards for completed months of active incentives. Awards for months not yet settled are worked out
-- again each time (a return can take one away before settlement); settled ones stay.
CREATE OR REPLACE FUNCTION partner_evaluate_incentives() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE i record; pm record; paid_so_far numeric; ok boolean;
BEGIN
  DELETE FROM partner_incentive_awards a WHERE a.auto AND a.settlement_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM partner_months m WHERE m.partner_id = a.partner_id AND m.month = a.month AND m.settled_at IS NOT NULL);
  FOR i IN SELECT * FROM partner_incentives WHERE status = 'active' AND kind <> 'manual' ORDER BY id LOOP
    SELECT COALESCE(sum(amount), 0) INTO paid_so_far FROM partner_incentive_awards WHERE incentive_id = i.id;
    FOR pm IN
      SELECT m.*, p.category, p.level AS plevel FROM partner_months m JOIN partners p ON p.id = m.partner_id
      WHERE m.month < partner_this_month() AND m.month BETWEEN to_char(i.starts_on, 'YYYY-MM') AND to_char(i.ends_on, 'YYYY-MM')
        AND p.status IN ('approved', 'on_hold', 'suspended', 'terminated')
        AND (cardinality(i.categories) = 0 OR p.category = ANY (i.categories))
        AND (cardinality(i.levels) = 0 OR COALESCE(m.partnership_level, p.level) = ANY (i.levels))
        AND NOT EXISTS (SELECT 1 FROM partner_incentive_awards a WHERE a.incentive_id = i.id AND a.partner_id = m.partner_id AND a.month = m.month)
      ORDER BY m.month, m.partner_id
    LOOP
      ok := false;
      IF i.kind = 'first_sale' THEN
        ok := pm.eligible_sales > 0
          AND NOT EXISTS (SELECT 1 FROM partner_months m2 WHERE m2.partner_id = pm.partner_id AND m2.month < pm.month AND m2.eligible_sales > 0)
          AND NOT EXISTS (SELECT 1 FROM partner_incentive_awards a WHERE a.incentive_id = i.id AND a.partner_id = pm.partner_id);
      ELSIF i.kind = 'monthly_sales' THEN
        ok := COALESCE(pm.threshold_sales, pm.eligible_sales) >= i.min_sales AND pm.eligible_sales > 0;
      ELSIF i.kind = 'consistency' THEN
        ok := (SELECT count(*) FROM partner_months m2 WHERE m2.partner_id = pm.partner_id
                 AND m2.month BETWEEN to_char(to_date(pm.month, 'YYYY-MM') - make_interval(months => i.months - 1), 'YYYY-MM') AND pm.month
                 AND COALESCE(m2.threshold_sales, m2.eligible_sales) >= i.min_sales AND m2.eligible_sales > 0) = i.months
          AND NOT EXISTS (SELECT 1 FROM partner_incentive_awards a WHERE a.incentive_id = i.id AND a.partner_id = pm.partner_id
                 AND a.month > to_char(to_date(pm.month, 'YYYY-MM') - make_interval(months => i.months), 'YYYY-MM'));
      END IF;
      IF ok AND (i.max_payout IS NULL OR paid_so_far + i.reward <= i.max_payout) THEN
        INSERT INTO partner_incentive_awards (incentive_id, partner_id, month, amount) VALUES (i.id, pm.partner_id, pm.month, i.reward) ON CONFLICT DO NOTHING;
        paid_so_far := paid_so_far + i.reward;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- ── Adjustments after settlement ──────────────────────────────────────────────
-- A settled month worked out again (returns, holds, claims, flags since): any difference from what was settled, less
-- adjustments already recorded for it, becomes a 'recalc' adjustment on the partner's next statement. Under the
-- month's own rules version, so a later rule change never reaches back.
CREATE OR REPLACE FUNCTION partner_detect_adjustments() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE r record; fresh jsonb; diff numeric; n integer := 0; sid integer;
BEGIN
  FOR r IN SELECT m.* FROM partner_months m WHERE m.settled_at IS NOT NULL LOOP
    fresh := partner_month_calc(r.partner_id, r.month);
    diff := (fresh ->> 'standard')::numeric + (fresh ->> 'campaign')::numeric + (fresh ->> 'bonus')::numeric
      - (COALESCE(r.standard_commission, r.commission) + COALESCE(r.campaign_commission, 0) + r.bonus)
      - COALESCE((SELECT sum(amount) FROM partner_adjustments a WHERE a.partner_id = r.partner_id AND a.month = r.month AND a.kind = 'recalc'), 0);
    IF abs(diff) >= 0.01 THEN
      SELECT id INTO sid FROM partner_settlements WHERE partner_id = r.partner_id AND month = r.month;
      INSERT INTO partner_adjustments (partner_id, kind, month, amount, reason, original_settlement_id, rule_version_id)
      VALUES (r.partner_id, 'recalc', r.month, round(diff, 2),
        'Recalculated after settlement: eligible sales ₹' || to_char(r.eligible_sales, 'FM99,99,99,990.00') || ' → ₹' || to_char((fresh ->> 'eligible')::numeric, 'FM99,99,99,990.00')
          || ', level ' || r.commission_level || ' → ' || (fresh ->> 'level'), sid, r.rule_version_id);
      UPDATE partner_settlements SET status = CASE WHEN status = 'paid' THEN 'adjusted' ELSE status END,
        adjusted_at = now(), updated_at = now() WHERE id = sid;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END
$$;

-- ── Settlements: create and work out ──────────────────────────────────────────
-- One statement per partner and completed month with anything in it (sales, a completed collaboration, an incentive,
-- or adjustments waiting with no open statement). Open statements are worked out again every time:
--   opening    the previous statement's carried balance (a negative balance, or a verified amount below the minimum)
--   gross      standard + campaign commission + bonus + collaboration fees + incentives
--   TDS        the rules' % once the partner's financial-year total passes the threshold (the year so far caught up)
--   net        opening + gross + adjustments − TDS
CREATE OR REPLACE FUNCTION partner_compute_settlement(p_id integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  s partner_settlements; c jsonb; v_collab numeric; v_inc numeric; v_adj numeric; opening numeric; v_gross numeric;
  fy_start text; fy_prior numeric; fy_taxed integer; base numeric; v_tds numeric; pct numeric; alloc jsonb; tot numeric; v_net numeric;
BEGIN
  SELECT * INTO s FROM partner_settlements WHERE id = p_id;
  IF s.status <> 'pending_verification' THEN RETURN; END IF;
  c := partner_month_calc(s.partner_id, s.month);
  SELECT COALESCE(sum(amount), 0) INTO v_collab FROM partner_collaborations
    WHERE partner_id = s.partner_id AND status = 'completed' AND partner_month_of(completed_at) <= s.month AND (settlement_id IS NULL OR settlement_id = s.id);
  SELECT COALESCE(sum(amount), 0) INTO v_inc FROM partner_incentive_awards
    WHERE partner_id = s.partner_id AND month <= s.month AND (settlement_id IS NULL OR settlement_id = s.id);
  SELECT COALESCE(sum(amount), 0) INTO v_adj FROM partner_adjustments
    WHERE partner_id = s.partner_id AND (applied_settlement_id IS NULL OR applied_settlement_id = s.id) AND (kind = 'recalc' OR approved_by IS NOT NULL);
  -- Carried forward: only a statement that was verified with nothing to pay (negative, or below the minimum payout).
  SELECT x.closing_balance INTO opening FROM partner_settlements x
    WHERE x.partner_id = s.partner_id AND x.month < s.month AND x.status <> 'pending_verification' ORDER BY x.month DESC LIMIT 1;
  IF NOT FOUND OR (SELECT x.status FROM partner_settlements x WHERE x.partner_id = s.partner_id AND x.month < s.month
                   AND x.status <> 'pending_verification' ORDER BY x.month DESC LIMIT 1) <> 'verified' THEN opening := 0; END IF;
  opening := COALESCE(opening, 0);
  v_gross := (c ->> 'standard')::numeric + (c ->> 'campaign')::numeric + (c ->> 'bonus')::numeric + v_collab + v_inc;
  -- TDS (financial year April–March).
  fy_start := CASE WHEN substr(s.month, 6, 2)::int >= 4 THEN substr(s.month, 1, 4) || '-04' ELSE (substr(s.month, 1, 4)::int - 1)::text || '-04' END;
  SELECT COALESCE(sum(GREATEST(x.gross + x.adjustments, 0)), 0), count(*) FILTER (WHERE x.tds > 0) INTO fy_prior, fy_taxed FROM partner_settlements x
    WHERE x.partner_id = s.partner_id AND x.month >= fy_start AND x.month < s.month AND x.status <> 'pending_verification';
  pct := partner_term(s.month, 'tdsPercent', 2);
  base := GREATEST(v_gross + v_adj, 0);
  IF fy_prior + base > partner_term(s.month, 'tdsAnnualThreshold', 20000) THEN
    v_tds := CASE WHEN fy_taxed = 0 THEN fy_prior + base ELSE base END;
  ELSE v_tds := 0; END IF;
  v_net := round(opening + v_gross + v_adj - round(v_tds * pct / 100, 2), 2);
  -- Expense allocation by entity: commission where the sale was made; bonus by bonus-qualifying sales; collaborations to
  -- the entity that approved them; incentives to their entity (or by sales); adjustments by sales.
  tot := NULLIF((SELECT sum(value::numeric) FROM jsonb_each_text(c -> 'byStore')), 0);
  WITH parts AS (
    SELECT partner_entity_of(key) AS entity, value::numeric AS commission, 0::numeric AS bonus, 0::numeric AS collab, 0::numeric AS incentives, 0::numeric AS adjustments
      FROM jsonb_each_text(c -> 'commissionByStore')
    UNION ALL
    SELECT partner_entity_of(key), 0, round((c ->> 'bonus')::numeric * value::numeric / NULLIF((SELECT sum(v::numeric) FROM jsonb_each_text(c -> 'bonusByStore') x(k, v)), 0), 2), 0, 0, 0
      FROM jsonb_each_text(c -> 'bonusByStore')
    UNION ALL
    SELECT entity, 0, 0, amount, 0, 0 FROM partner_collaborations
      WHERE partner_id = s.partner_id AND status = 'completed' AND partner_month_of(completed_at) <= s.month AND (settlement_id IS NULL OR settlement_id = s.id)
    UNION ALL
    SELECT COALESCE(i.entity, 'Deepam by Ananta'), 0, 0, 0, a.amount, 0 FROM partner_incentive_awards a JOIN partner_incentives i ON i.id = a.incentive_id
      WHERE a.partner_id = s.partner_id AND a.month <= s.month AND (a.settlement_id IS NULL OR a.settlement_id = s.id)
    UNION ALL
    SELECT CASE WHEN tot IS NULL THEN 'Deepam by Ananta' ELSE partner_entity_of(key) END, 0, 0, 0, 0,
      CASE WHEN tot IS NULL THEN v_adj ELSE round(v_adj * value::numeric / tot, 2) END
      FROM (SELECT * FROM jsonb_each_text(c -> 'byStore') UNION ALL SELECT '-', '0' WHERE tot IS NULL) b WHERE v_adj <> 0
  )
  SELECT COALESCE(jsonb_object_agg(entity, jsonb_build_object('commission', commission, 'bonus', bonus, 'collab', collab, 'incentives', incentives, 'adjustments', adjustments,
    'total', commission + bonus + collab + incentives + adjustments)), '{}'::jsonb) INTO alloc
  FROM (SELECT entity, sum(commission) AS commission, sum(bonus) AS bonus, sum(collab) AS collab, sum(incentives) AS incentives, sum(adjustments) AS adjustments
        FROM parts GROUP BY entity) g;

  UPDATE partner_settlements SET
    rule_version_id = COALESCE((c ->> 'ruleVersionId')::int, (partner_rules_for(s.month)).id),
    opening_balance = opening, eligible_sales = (c ->> 'eligible')::numeric, threshold_sales = (c ->> 'threshold')::numeric, by_store = c -> 'byStore',
    commission_level = (c ->> 'level')::int, commission_percent = (c ->> 'percent')::numeric,
    standard_commission = (c ->> 'standard')::numeric, campaign_commission = (c ->> 'campaign')::numeric, bonus = (c ->> 'bonus')::numeric,
    collab_fees = v_collab, incentives = v_inc, adjustments = v_adj, gross = v_gross,
    tds_base = v_tds, tds_percent = pct, tds = round(v_tds * pct / 100, 2),
    net_payable = v_net, closing_balance = v_net - paid_amount,
    held_lines = (SELECT count(*) FROM partner_commissions pc WHERE pc.partner_id = s.partner_id AND partner_month_of(pc.billed_at) = s.month AND pc.on_hold),
    allocation = alloc, updated_at = now()
  WHERE id = p_id;
END
$$;

CREATE OR REPLACE FUNCTION partner_refresh_settlements() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  from_month text := COALESCE((SELECT value #>> '{}' FROM settings WHERE key = 'partner_settlements_from'), '2026-11');
  last_done text := to_char(to_date(partner_this_month(), 'YYYY-MM') - interval '1 month', 'YYYY-MM');
  x record;
BEGIN
  IF last_done < from_month THEN RETURN; END IF;
  INSERT INTO partner_settlements (partner_id, month)
  SELECT DISTINCT partner_id, month FROM (
    SELECT partner_id, month FROM partner_months WHERE month BETWEEN from_month AND last_done AND (eligible_sales <> 0 OR commission <> 0 OR bonus <> 0)
    UNION SELECT partner_id, partner_month_of(completed_at) FROM partner_collaborations WHERE status = 'completed' AND partner_month_of(completed_at) BETWEEN from_month AND last_done
    UNION SELECT partner_id, month FROM partner_incentive_awards WHERE month BETWEEN from_month AND last_done AND settlement_id IS NULL
    UNION SELECT a.partner_id, last_done FROM partner_adjustments a WHERE a.applied_settlement_id IS NULL AND (a.kind = 'recalc' OR a.approved_by IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM partner_settlements s WHERE s.partner_id = a.partner_id AND s.status = 'pending_verification')
  ) k
  ON CONFLICT (partner_id, month) DO NOTHING;
  FOR x IN SELECT id FROM partner_settlements WHERE status = 'pending_verification' LOOP
    PERFORM partner_compute_settlement(x.id);
  END LOOP;
END
$$;
