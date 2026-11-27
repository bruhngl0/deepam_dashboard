-- Ananta Partner Network: program rules v1.0 (phase 1: rules, levels, whole-month commission, level reviews).
--
-- Rules are versions, never edited in place: each save is a new row with the month it takes effect from, who saved it
-- and why. A month's numbers always use the version in force for that month, so changing a rate never rewrites a
-- month already earned.
--
-- Commission is per calendar month: the partner's eligible net sales for the month (bills matched to their
-- referrals, before GST, less returns) decide the commission level, and that level's percentage applies to the whole
-- month's value (not slab by slab), plus that level's monthly bonus. Separately, the partnership level (personal
-- discount and other benefits) is reviewed at each month end from the average of the last three completed months.

-- ── Rule versions ─────────────────────────────────────────────────────────────
-- levels: [{ level, name, minSales, commissionPercent, bonus, influencerLimit, personalDiscount, benefits }] for 1..5,
-- minSales ascending from 0 (a level holds from its minSales up to the next level's).
-- terms:  { referralDays, lookbackYears, reviewMonths, downgradeAfter, annualShoppingLimit }
CREATE TABLE IF NOT EXISTS partner_rule_versions (
  id serial PRIMARY KEY,
  effective_month text NOT NULL CHECK (effective_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  levels jsonb NOT NULL,
  terms jsonb NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO partner_rule_versions (effective_month, levels, terms, reason, changed_by)
SELECT '2026-01',
  '[{"level":1,"name":"Level 1","minSales":0,"commissionPercent":10,"bonus":0,"influencerLimit":0,"personalDiscount":0,"benefits":""},
    {"level":2,"name":"Level 2","minSales":200000,"commissionPercent":10,"bonus":1000,"influencerLimit":5000,"personalDiscount":10,"benefits":""},
    {"level":3,"name":"Level 3","minSales":500000,"commissionPercent":10,"bonus":2000,"influencerLimit":10000,"personalDiscount":10,"benefits":""},
    {"level":4,"name":"Level 4","minSales":700000,"commissionPercent":12,"bonus":3000,"influencerLimit":20000,"personalDiscount":15,"benefits":""},
    {"level":5,"name":"Level 5","minSales":1000000,"commissionPercent":15,"bonus":5000,"influencerLimit":50000,"personalDiscount":20,"benefits":""}]'::jsonb,
  '{"referralDays":30,"lookbackYears":2,"reviewMonths":3,"downgradeAfter":2,"annualShoppingLimit":100000}'::jsonb,
  'Program Rules & Commercial Configuration v1.0', 'Program rules v1.0'
WHERE NOT EXISTS (SELECT 1 FROM partner_rule_versions);

-- The version in force for a month (YYYY-MM): the latest effective on or before it; the latest saved wins a tie.
CREATE OR REPLACE FUNCTION partner_rules_for(p_month text) RETURNS partner_rule_versions
LANGUAGE sql STABLE AS $$
  SELECT * FROM partner_rule_versions WHERE effective_month <= p_month ORDER BY effective_month DESC, id DESC LIMIT 1
$$;
CREATE OR REPLACE FUNCTION partner_month_of(p_at timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT to_char(p_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') $$;
CREATE OR REPLACE FUNCTION partner_this_month() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT partner_month_of(now()) $$;

-- Referral terms now come from the rules in force this month (was the settings table).
CREATE OR REPLACE FUNCTION partner_setting_int(p_key text, p_default integer) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT (r.terms ->> CASE p_key WHEN 'partner_purchase_window_days' THEN 'referralDays' WHEN 'partner_lookback_years' THEN 'lookbackYears' ELSE p_key END)::integer
    FROM partner_rules_for(partner_this_month()) r
  ), p_default)
$$;

-- The level a monthly value reaches under a version: the highest whose minSales it meets.
CREATE OR REPLACE FUNCTION partner_level_for(p_levels jsonb, p_value numeric) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT l FROM jsonb_array_elements(p_levels) l WHERE p_value >= (l ->> 'minSales')::numeric
  ORDER BY (l ->> 'minSales')::numeric DESC LIMIT 1
$$;

-- ── Partner categories ────────────────────────────────────────────────────────
-- Editable under Rules; the application form offers the active ones. Existing partners move to the program's names.
CREATE TABLE IF NOT EXISTS partner_categories (
  name text PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO partner_categories (name, sort) VALUES
  ('Loyal Customers', 1), ('Makeup Artists', 2), ('Fashion Stylists', 3), ('Influencers & Content Creators', 4),
  ('Wedding Professionals', 5), ('Community Partners', 6), ('Former Employees', 7), ('Independent Sales Partners', 8),
  ('Wedding Venues', 9), ('Photographers', 10)
ON CONFLICT (name) DO NOTHING;
UPDATE partners SET category = m.new, updated_at = now()
FROM (VALUES ('Loyal customer', 'Loyal Customers'), ('Makeup artist', 'Makeup Artists'), ('Stylist', 'Fashion Stylists'),
             ('Influencer', 'Influencers & Content Creators'), ('Wedding professional', 'Wedding Professionals'),
             ('Wedding venue', 'Wedding Venues'), ('Community partner', 'Community Partners'),
             ('Former Deepam employee', 'Former Employees'), ('Photographer', 'Photographers')) AS m(old, new)
WHERE partners.category = m.old;
INSERT INTO partner_categories (name) SELECT DISTINCT category FROM partners ON CONFLICT (name) DO NOTHING;

-- ── Partner statuses ──────────────────────────────────────────────────────────
--   applied (Pending approval) · approved (Active) · on_hold (no new referrals or payouts, pending review)
--   suspended (no new referrals or privileges) · rejected · terminated (partnership closed)
-- Earned commissions are never erased by a status. Every change is logged with a reason, a date and who made it.
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_status_check;
ALTER TABLE partners ADD CONSTRAINT partners_status_check CHECK (status IN ('applied', 'approved', 'on_hold', 'suspended', 'rejected', 'terminated'));
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_check;
ALTER TABLE partners ADD CONSTRAINT partners_check CHECK (status NOT IN ('approved', 'on_hold', 'suspended', 'terminated') OR (partner_code IS NOT NULL AND dashboard_token IS NOT NULL));
-- Consecutive month-end reviews below the current level's threshold (two in a row downgrade).
ALTER TABLE partners ADD COLUMN IF NOT EXISTS below_streak integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS partner_status_log (
  id bigserial PRIMARY KEY,
  partner_id integer NOT NULL REFERENCES partners (id),
  from_status text,
  to_status text NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_status_log_partner_idx ON partner_status_log (partner_id, changed_at DESC);

-- ── Referrals: existing customers ─────────────────────────────────────────────
-- A number with a bill in the look-back years can now be referred, but the partner's part in the purchase has to be
-- verified: verify_status 'pending' until staff verify it (or decline it as an existing customer). Its bills earn only
-- once verified. New customers have no verify_status.
ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS verify_status text CHECK (verify_status IN ('pending', 'verified'));
ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS verified_by text;
ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS verify_note text;

CREATE OR REPLACE FUNCTION partner_is_existing_customer(p_phone text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH since AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date - make_interval(years => partner_setting_int('partner_lookback_years', 2)) AS d)
  SELECT EXISTS (
    SELECT 1 FROM customers c JOIN sales s ON s.customer_id = c.id
    WHERE c.phone_e164 = p_phone AND s.bill_amount > 0 AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date >= (SELECT d FROM since)
  ) OR EXISTS (
    SELECT 1 FROM customers c JOIN loyalty_customers l ON l.customer_id = c.id
    WHERE c.phone_e164 = p_phone AND l.last_bill_date >= (SELECT d FROM since)
  )
$$;

-- Why a phone cannot be referred by this partner right now, or NULL when it can. An existing customer can be
-- (partner_is_existing_customer marks the referral for verification instead).
CREATE OR REPLACE FUNCTION partner_referral_block(p_phone text, p_partner_id integer) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM partners WHERE id = p_partner_id AND phone_e164 = p_phone) THEN 'own_number'
    WHEN EXISTS (SELECT 1 FROM internal_accounts WHERE phone_e164 = p_phone) THEN 'internal_number'
    WHEN EXISTS (
      SELECT 1 FROM partner_referrals r
      WHERE r.phone_e164 = p_phone AND r.status IN ('registered', 'converted')
        AND r.window_ends_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    ) THEN 'already_referred'
  END
$$;

-- ── Commission lines: net value and month ─────────────────────────────────────
-- net_amount: the bill's value before GST (taxable value, after item discounts; the bill amount when the POS gave
-- none), less what later returns took back, in proportion; nothing once fully returned. Kept up to date until paid.
ALTER TABLE partner_commissions ADD COLUMN IF NOT EXISTS net_amount numeric(12, 2);

CREATE OR REPLACE FUNCTION partner_net_value(p_bill numeric, p_taxable numeric, p_returned numeric, p_fully boolean) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_fully OR p_bill <= 0 THEN 0
    ELSE round(COALESCE(p_taxable, p_bill) * GREATEST(0, 1 - COALESCE(p_returned, 0) / p_bill), 2) END
$$;

-- ── Months ────────────────────────────────────────────────────────────────────
-- One row per partner and month with bills: the month's eligible net sales, the commission level they reached, its
-- rate, the whole-month commission and the bonus, under the rules version in force that month. Recalculated while
-- the month is unpaid (returns before settlement change it); frozen once paid.
CREATE TABLE IF NOT EXISTS partner_months (
  partner_id integer NOT NULL REFERENCES partners (id),
  month text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  rule_version_id integer NOT NULL REFERENCES partner_rule_versions (id),
  eligible_sales numeric(14, 2) NOT NULL,
  by_store jsonb NOT NULL DEFAULT '{}'::jsonb,
  commission_level integer NOT NULL,
  commission_percent numeric(5, 2) NOT NULL,
  commission numeric(12, 2) NOT NULL,
  bonus numeric(12, 2) NOT NULL,
  partnership_level integer,
  paid_at timestamptz,
  payout_reference text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, month)
);

-- ── Level reviews ─────────────────────────────────────────────────────────────
-- Month-end reviews (kind 'monthly', one per partner and month) and manual changes (kind 'manual', with a reason).
CREATE TABLE IF NOT EXISTS partner_level_reviews (
  id bigserial PRIMARY KEY,
  partner_id integer NOT NULL REFERENCES partners (id),
  kind text NOT NULL CHECK (kind IN ('monthly', 'manual')),
  review_month text CHECK (review_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  months_counted integer,
  average_sales numeric(14, 2),
  qualifying_level integer,
  previous_level integer NOT NULL,
  new_level integer NOT NULL,
  below_streak integer,
  effective_month text NOT NULL,
  note text,
  changed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'manual' OR review_month IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_level_reviews_monthly_uidx ON partner_level_reviews (partner_id, review_month) WHERE kind = 'monthly';
INSERT INTO settings (key, value, description) VALUES
  ('partner_reviews_from', '"2026-11"', 'Partner Network: the first month whose month-end partnership level review runs.')
ON CONFLICT (key) DO NOTHING;

-- Months with bills, recalculated: net values on unpaid lines, then partner_months for every unpaid partner-month.
-- Lines of an existing-customer referral not yet verified do not count. Validated, unpaid lines take their month's
-- rate (whole-month), so returns and new bills move every line of the month together.
CREATE OR REPLACE FUNCTION partner_refresh_months() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE partner_commissions pc
  SET net_amount = partner_net_value(s.bill_amount, s.taxable_amount, s.returned_amount, s.fully_returned)
  FROM sales s
  WHERE s.voucher_no = pc.voucher_no AND pc.status <> 'paid'
    AND pc.net_amount IS DISTINCT FROM partner_net_value(s.bill_amount, s.taxable_amount, s.returned_amount, s.fully_returned);
  -- A line whose bill left the sync keeps its last net value; a line never seen with one falls back to the bill amount.
  UPDATE partner_commissions SET net_amount = bill_amount WHERE net_amount IS NULL;

  WITH lines AS (
    SELECT pc.partner_id, partner_month_of(pc.billed_at) AS month, pc.net_amount, st.code AS store
    FROM partner_commissions pc
    JOIN partner_referrals r ON r.id = pc.referral_id
    LEFT JOIN stores st ON st.id = pc.store_id
    WHERE pc.status IN ('pending', 'validated', 'paid') AND r.verify_status IS DISTINCT FROM 'pending'
  ), per_store AS (
    SELECT partner_id, month, COALESCE(store, '-') AS store, sum(net_amount) AS v FROM lines GROUP BY 1, 2, 3
  ), totals AS (
    SELECT partner_id, month, sum(v) AS eligible, jsonb_object_agg(store, v) AS by_store FROM per_store GROUP BY 1, 2
  ), calc AS (
    SELECT t.partner_id, t.month, t.eligible, t.by_store, rv.id AS rule_version_id,
      partner_level_for(rv.levels, t.eligible) AS lv
    FROM totals t CROSS JOIN LATERAL partner_rules_for(t.month) rv
  )
  INSERT INTO partner_months AS m (partner_id, month, rule_version_id, eligible_sales, by_store, commission_level, commission_percent, commission, bonus, partnership_level, updated_at)
  SELECT c.partner_id, c.month, c.rule_version_id, c.eligible, c.by_store, (c.lv ->> 'level')::int, (c.lv ->> 'commissionPercent')::numeric,
    round(c.eligible * (c.lv ->> 'commissionPercent')::numeric / 100, 2), (c.lv ->> 'bonus')::numeric,
    CASE WHEN c.month = partner_this_month() THEN p.level END, now()
  FROM calc c JOIN partners p ON p.id = c.partner_id
  ON CONFLICT (partner_id, month) DO UPDATE SET
    rule_version_id = excluded.rule_version_id, eligible_sales = excluded.eligible_sales, by_store = excluded.by_store,
    commission_level = excluded.commission_level, commission_percent = excluded.commission_percent,
    commission = excluded.commission, bonus = excluded.bonus,
    partnership_level = COALESCE(excluded.partnership_level, m.partnership_level), updated_at = now()
  WHERE m.paid_at IS NULL AND (m.rule_version_id, m.eligible_sales, m.by_store, m.commission_level, m.commission_percent, m.commission, m.bonus)
    IS DISTINCT FROM (excluded.rule_version_id, excluded.eligible_sales, excluded.by_store, excluded.commission_level, excluded.commission_percent, excluded.commission, excluded.bonus);

  -- A month every bill of which was rejected or returned has nothing left: no commission, no bonus.
  UPDATE partner_months m SET eligible_sales = 0, by_store = '{}'::jsonb, commission = 0, bonus = 0, commission_level = 1,
    commission_percent = (partner_level_for((partner_rules_for(m.month)).levels, 0) ->> 'commissionPercent')::numeric, updated_at = now()
  WHERE m.paid_at IS NULL AND m.eligible_sales <> 0 AND NOT EXISTS (
    SELECT 1 FROM partner_commissions pc JOIN partner_referrals r ON r.id = pc.referral_id
    WHERE pc.partner_id = m.partner_id AND partner_month_of(pc.billed_at) = m.month
      AND pc.status IN ('pending', 'validated', 'paid') AND r.verify_status IS DISTINCT FROM 'pending');

  -- Validated, unpaid lines: their month's whole-month rate.
  UPDATE partner_commissions pc SET commission_percent = m.commission_percent, level = m.commission_level,
    commission_amount = round(pc.net_amount * m.commission_percent / 100, 2), payout_month = m.month
  FROM partner_months m
  WHERE pc.status = 'validated' AND m.partner_id = pc.partner_id AND m.month = partner_month_of(pc.billed_at)
    AND (pc.commission_percent, pc.level, pc.commission_amount, pc.payout_month)
      IS DISTINCT FROM (m.commission_percent, m.commission_level, round(pc.net_amount * m.commission_percent / 100, 2), m.month);
END
$$;

-- Month-end partnership level reviews for every completed month not yet reviewed (from partner_reviews_from), in
-- order. For each partner approved before the month: the average eligible sales of the last `reviewMonths` completed
-- months since their first full month (their approval month never counts; months with nothing count as zero), the
-- level that average reaches, then: higher → upgrade now; lower → a downgrade only after `downgradeAfter` reviews in
-- a row below, to the level of the latest average; the new level holds from the next month.
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
      SELECT COALESCE(sum(eligible_sales), 0) / n_months INTO avg_sales
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
