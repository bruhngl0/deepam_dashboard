-- Partner Network Management (Deepam Partners).
--
-- A partner applies on the public form (/deepampartner). Staff approve them in the Partner Network module, which
-- issues a Partner ID (DPR-00001), a referral link (/deepampartner/DPR-00001) and a private dashboard link. Customers
-- register on the referral link; a bill on their phone within the purchase window becomes a commission, which staff
-- validate into a monthly payout.
--
-- The terms still to be decided (commission % per level, the purchase window, the look-back for "already a buyer")
-- are rows here, not constants in code, so they can change without a deploy.

-- ── Commission levels ─────────────────────────────────────────────────────────
-- Five levels. The percentage is empty until it is decided; a commission cannot be validated while its level has none.
CREATE TABLE IF NOT EXISTS partner_levels (
  level integer PRIMARY KEY CHECK (level BETWEEN 1 AND 5),
  name text NOT NULL,
  commission_percent numeric(5, 2) CHECK (commission_percent >= 0 AND commission_percent <= 100),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO partner_levels (level, name)
VALUES (1, 'Level 1'), (2, 'Level 2'), (3, 'Level 3'), (4, 'Level 4'), (5, 'Level 5')
ON CONFLICT (level) DO NOTHING;

INSERT INTO settings (key, value, description) VALUES
  ('partner_purchase_window_days', '60', 'Partner referrals: a bill counts only if it is within this many days of the customer registering.'),
  ('partner_lookback_years', '2', 'Partner referrals: a number with a bill in this many past years is already a customer and cannot be referred.')
ON CONFLICT (key) DO NOTHING;

-- ── Partners ──────────────────────────────────────────────────────────────────
-- One row per applicant, keyed by phone. `partner_code` and `dashboard_token` are issued on approval only, so a
-- rejected applicant never takes a Partner ID. The category list lives in code (lib/partners/constants.ts): Driver
-- is to be added later without a migration.
-- `documents`: the legal documents collected after approval, { "<kind>": "YYYY-MM-DD received" }. Only the fact of
-- receipt is kept here, never a PAN, Aadhaar or account number.
CREATE SEQUENCE IF NOT EXISTS partner_code_seq;
CREATE TABLE IF NOT EXISTS partners (
  id serial PRIMARY KEY,
  partner_code text UNIQUE CHECK (partner_code ~ '^DPR-\d{5,}$'),
  full_name text NOT NULL,
  contact text NOT NULL,
  phone_e164 text NOT NULL UNIQUE,
  email text NOT NULL,
  category text NOT NULL,
  city text NOT NULL,
  consent_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'approved', 'rejected', 'suspended')),
  status_note text,
  level integer NOT NULL DEFAULT 1 REFERENCES partner_levels (level),
  documents jsonb NOT NULL DEFAULT '{}'::jsonb,
  dashboard_token text UNIQUE,
  notes text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  decided_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('approved', 'suspended') OR (partner_code IS NOT NULL AND dashboard_token IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS partners_status_idx ON partners (status, applied_at DESC);

-- ── Referrals ─────────────────────────────────────────────────────────────────
-- Every registration on a referral link, accepted or not. A declined one is kept (with its reason) so a disputed
-- referral can be checked; it never earns.
--   registered  accepted, purchase window open, no bill yet
--   converted   a bill within the window (one or more commissions)
--   expired     window closed with no bill
--   declined    not accepted: recent_purchase | already_referred | own_number | internal_number
-- `registered_on` / `window_ends_on` are IST dates: imported bills often carry a date with a placeholder time, so the
-- window is compared by day, never by timestamp.
CREATE TABLE IF NOT EXISTS partner_referrals (
  id bigserial PRIMARY KEY,
  partner_id integer NOT NULL REFERENCES partners (id),
  full_name text NOT NULL,
  contact text NOT NULL,
  phone_e164 text NOT NULL,
  customer_id bigint REFERENCES customers (id) ON DELETE SET NULL,
  occasion text NOT NULL,
  preferred_store_id integer REFERENCES stores (id),
  appointment_date date,
  consent_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('registered', 'converted', 'expired', 'declined')),
  decline_reason text CHECK (decline_reason IN ('recent_purchase', 'already_referred', 'own_number', 'internal_number')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  registered_on date NOT NULL,
  window_ends_on date NOT NULL,
  converted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'declined') = (decline_reason IS NOT NULL)),
  CHECK (window_ends_on >= registered_on)
);
-- One open referral per phone: the first partner to register a customer keeps them.
CREATE UNIQUE INDEX IF NOT EXISTS partner_referrals_open_phone_uidx ON partner_referrals (phone_e164) WHERE status = 'registered';
CREATE INDEX IF NOT EXISTS partner_referrals_phone_idx ON partner_referrals (phone_e164);
CREATE INDEX IF NOT EXISTS partner_referrals_partner_idx ON partner_referrals (partner_id, registered_at DESC);
CREATE INDEX IF NOT EXISTS partner_referrals_customer_idx ON partner_referrals (customer_id) WHERE customer_id IS NOT NULL;

-- ── Commissions ───────────────────────────────────────────────────────────────
-- One row per bill matched to a referral. A bill earns for one referral only (`voucher_no` is unique). No foreign
-- key to `sales`: the Hemparshwa sync deletes and re-inserts bills, which must never be blocked by a commission.
--   pending    matched, waiting for staff to validate
--   validated  checked; rate and amount fixed; in the payout cycle for `payout_month`
--   rejected   not payable (e.g. returned, wrong person); kept with a note
--   paid       paid out in `payout_month`, with the payment reference
CREATE TABLE IF NOT EXISTS partner_commissions (
  id bigserial PRIMARY KEY,
  referral_id bigint NOT NULL REFERENCES partner_referrals (id) ON DELETE CASCADE,
  partner_id integer NOT NULL REFERENCES partners (id),
  voucher_no text NOT NULL UNIQUE,
  store_id integer REFERENCES stores (id),
  billed_at timestamptz NOT NULL,
  bill_amount numeric(12, 2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'rejected', 'paid')),
  level integer,
  commission_percent numeric(5, 2),
  commission_amount numeric(12, 2),
  payout_month text CHECK (payout_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  note text,
  matched_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  paid_at timestamptz,
  payout_reference text,
  CHECK (status NOT IN ('validated', 'paid') OR (commission_amount IS NOT NULL AND payout_month IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS partner_commissions_partner_idx ON partner_commissions (partner_id, status);
CREATE INDEX IF NOT EXISTS partner_commissions_payout_idx ON partner_commissions (payout_month, partner_id) WHERE payout_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_commissions_referral_idx ON partner_commissions (referral_id);

-- ── Rules ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION partner_setting_int(p_key text, p_default integer) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT (value #>> '{}')::integer FROM settings WHERE key = p_key), p_default)
$$;

-- Why a phone cannot be referred by this partner right now, or NULL when it can.
--   own_number        the partner's own phone
--   internal_number   a store, staff or test number (internal_accounts)
--   recent_purchase   a bill in the look-back years (CRM bills, or the loyalty list's last bill date)
--   already_referred  another referral for the number is still inside its purchase window
CREATE OR REPLACE FUNCTION partner_referral_block(p_phone text, p_partner_id integer) RETURNS text
LANGUAGE sql STABLE AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
  since AS (SELECT (SELECT d FROM today) - make_interval(years => partner_setting_int('partner_lookback_years', 2)) AS d)
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM partners WHERE id = p_partner_id AND phone_e164 = p_phone) THEN 'own_number'
    WHEN EXISTS (SELECT 1 FROM internal_accounts WHERE phone_e164 = p_phone) THEN 'internal_number'
    WHEN EXISTS (
      SELECT 1 FROM customers c JOIN sales s ON s.customer_id = c.id
      WHERE c.phone_e164 = p_phone AND s.bill_amount > 0
        AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date >= (SELECT d FROM since)
    ) OR EXISTS (
      SELECT 1 FROM customers c JOIN loyalty_customers l ON l.customer_id = c.id
      WHERE c.phone_e164 = p_phone AND l.last_bill_date >= (SELECT d FROM since)
    ) THEN 'recent_purchase'
    WHEN EXISTS (
      SELECT 1 FROM partner_referrals r
      WHERE r.phone_e164 = p_phone AND r.status IN ('registered', 'converted') AND r.window_ends_on >= (SELECT d FROM today)
    ) THEN 'already_referred'
  END
$$;

-- Matches bills to referrals and brings every referral's status up to date. Idempotent; safe to run on every page
-- load. With a phone, only that number's referrals are touched (used just before a new registration is saved).
--   1. a referral learns its CRM customer once one exists for the phone (Customer ID or phone: either links)
--   2. a pending commission whose bill is gone, or now sits on someone else, is dropped; its amount follows the bill
--   3. each bill on the customer dated inside a referral's window becomes a pending commission (the earliest
--      referral wins a bill that falls in two windows)
--   4. status: converted with any commission not rejected, else expired after the window, else registered
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
  WHERE pc.referral_id = r.id AND pc.status = 'pending' AND (p_phone IS NULL OR r.phone_e164 = p_phone)
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
