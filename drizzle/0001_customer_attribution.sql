-- Derived attribution layer. Hand-written because Drizzle has no DSL for
-- materialized views or functions. See SYSTEM_DESIGN.md §5.2 and §6.
--
-- Everything here is DERIVED. `lead_touches` and `sales` are truth; this file
-- is one interpretation of them and can be dropped and rebuilt at any time.
-- That is what makes the attribution rules (D-44, D-45) safely changeable.

-- ─────────────────────────────────────────────────────────────────────────────
-- Lifecycle recompute (D-38)
--
-- Recomputed from scratch after every import, never incrementally patched.
-- Import order must not matter: a sales-first import would otherwise classify
-- an entire file as 'existing', and a later lead import has to be able to flip
-- those rows back to 'new'.
--
-- Precedence (D-36):
--   prior_purchase  → existing   a bill predates the campaign window  (provable)
--   self_declared   → existing   walk-in form says "Existing Customer"
--   lead_matched    → new        appears in any lead source
--   no_lead_match   → existing   bought with no lead record           (inferred)
--   otherwise       → unknown    a lead who hasn't bought is neither yet (D-39)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recompute_customer_lifecycle()
RETURNS void
LANGUAGE sql
AS $$
  WITH basis AS (
    SELECT
      c.id AS customer_id,
      CASE
        -- Provable: a purchase before this customer's first recorded touch.
        WHEN EXISTS (
          SELECT 1
          FROM   sales s
          WHERE  s.customer_id = c.id
            AND  s.billed_at < COALESCE(
                   (SELECT MIN(lt.touched_at) FROM lead_touches lt
                     WHERE lt.customer_id = c.id),
                   'infinity'::timestamptz)
        ) THEN 'prior_purchase'::lifecycle_basis

        -- The customer told us so on the walk-in form.
        WHEN EXISTS (
          SELECT 1 FROM walkin_submissions w
          WHERE  w.customer_id = c.id
            AND  w.how_did_you_hear = 'Existing Customer'
        ) THEN 'self_declared'::lifecycle_basis

        -- Appears in a lead source → treat as an acquisition target.
        WHEN EXISTS (
          SELECT 1 FROM lead_touches lt WHERE lt.customer_id = c.id
        ) THEN 'lead_matched'::lifecycle_basis

        -- Bought, but matches no lead record at all.
        WHEN EXISTS (
          SELECT 1 FROM sales s WHERE s.customer_id = c.id
        ) THEN 'no_lead_match'::lifecycle_basis

        ELSE NULL
      END AS lifecycle_basis
    FROM customers c
  )
  UPDATE customers c
  SET    lifecycle_basis = b.lifecycle_basis,
         lifecycle = CASE b.lifecycle_basis
                       WHEN 'prior_purchase' THEN 'existing'
                       WHEN 'self_declared'  THEN 'existing'
                       WHEN 'no_lead_match'  THEN 'existing'
                       WHEN 'lead_matched'   THEN 'new'
                       ELSE 'unknown'
                     END::lifecycle,
         lifecycle_at = now(),
         updated_at = now()
  FROM   basis b
  WHERE  b.customer_id = c.id
    AND (c.lifecycle_basis IS DISTINCT FROM b.lifecycle_basis);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- customer_attribution (D-65)
--
-- Exclusive-mode credit: one channel per customer, so the dashboard's channel
-- rows sum exactly to the total. Influenced/any-touch mode is computed at query
-- time straight from lead_touches and is deliberately not materialized here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW customer_attribution AS
WITH first_touch AS (
  -- Earliest touch wins; ties break on channel priority (D-44).
  SELECT DISTINCT ON (lt.customer_id)
         lt.customer_id,
         lt.campaign_id,
         lt.channel,
         lt.touched_at
  FROM   lead_touches lt
  ORDER  BY lt.customer_id,
            lt.touched_at ASC,
            CASE lt.channel
              WHEN 'walkin'   THEN 1
              WHEN 'meta'     THEN 2
              WHEN 'whatsapp' THEN 3
              ELSE 4
            END
),
sale_agg AS (
  SELECT s.customer_id,
         COUNT(*)           AS bill_count,
         SUM(s.bill_amount) AS total_sales,
         MIN(s.billed_at)   AS first_sale_at,
         MAX(s.billed_at)   AS last_sale_at
  FROM   sales s
  WHERE  s.customer_id IS NOT NULL
  GROUP  BY s.customer_id
)
SELECT
  c.id AS customer_id,
  -- Existing customers are credited to 'existing', never to a campaign (D-43).
  -- Buyers with no lead record fall here too, via lifecycle = 'existing'.
  CASE
    WHEN c.lifecycle = 'existing' THEN 'existing'::channel
    ELSE COALESCE(ft.channel, 'existing'::channel)
  END AS primary_channel,
  CASE WHEN c.lifecycle = 'existing' THEN NULL ELSE ft.campaign_id END
    AS primary_campaign_id,
  ft.touched_at AS first_touch_at,
  c.lifecycle,
  c.lifecycle_basis,
  -- Only lead-matched, non-existing customers belong in an acquisition
  -- denominator. Including inferred-existing buyers moves the headline
  -- conversion rate from 5.1% to 10.6% and makes it rise as lead capture
  -- degrades (D-46).
  (ft.customer_id IS NOT NULL AND c.lifecycle <> 'existing' AND NOT c.is_foreign)
    AS in_acquisition_funnel,
  COALESCE(sa.bill_count, 0)  AS bill_count,
  COALESCE(sa.total_sales, 0) AS total_sales,
  sa.first_sale_at,
  sa.last_sale_at,
  (sa.customer_id IS NOT NULL) AS converted,
  CASE
    WHEN sa.first_sale_at IS NOT NULL AND ft.touched_at IS NOT NULL
    THEN EXTRACT(DAY FROM sa.first_sale_at - ft.touched_at)::int
  END AS days_to_convert
FROM       customers c
LEFT JOIN  first_touch ft ON ft.customer_id = c.id
LEFT JOIN  sale_agg    sa ON sa.customer_id = c.id;

-- CONCURRENTLY requires a unique index, and refreshing concurrently is what
-- keeps the dashboard readable during an import (D-61).
CREATE UNIQUE INDEX customer_attribution_pk
  ON customer_attribution (customer_id);
CREATE INDEX customer_attribution_channel_idx
  ON customer_attribution (primary_channel, converted);
CREATE INDEX customer_attribution_funnel_idx
  ON customer_attribution (lifecycle, in_acquisition_funnel);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tunable constants (DECISIONS.md §N)
--
-- In the database rather than in code so the four settings that move the
-- headline conversion rate between 5.1% and 12.7% can be changed without a
-- deploy, and so any published figure can name the settings that produced it.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO settings (key, value, description) VALUES
  ('attribution_window_days', '30',
   'Days after first touch within which a sale counts as a conversion (D-45)'),
  ('channel_priority', '["walkin","meta","whatsapp","other"]',
   'Tie-break order for exclusive attribution when timestamps match (D-44)'),
  ('exclude_foreign_from_metrics', 'true',
   'Keep non-Indian numbers out of conversion denominators (D-21)'),
  ('exclude_existing_from_funnel', 'true',
   'Keep existing customers out of the acquisition funnel; false gives 10.6% (D-46)'),
  ('whatsapp_counts_as_lead', 'true',
   'Count broadcast recipients as leads; false gives 12.7% (D-52)'),
  ('default_attribution_mode', '"exclusive"',
   'exclusive | influenced — Meta converts 29 vs 85 (D-41, D-42)'),
  ('timezone', '"Asia/Kolkata"',
   'Display timezone; storage is always UTC (D-32)')
ON CONFLICT (key) DO NOTHING;
