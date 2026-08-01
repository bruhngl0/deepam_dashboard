-- Fix: `prior_purchase` compared a bill against the customer's own first touch,
-- rather than against the campaign window. (D-36, D-37)
--
-- In a retail store the walk-in form is frequently completed *at billing*. A
-- customer who bought at 10:00 and was onboarded at 14:00 the same day then
-- looked like a pre-existing relationship, when it was one visit. This
-- misclassified 188 customers — ₹48,70,785 — as provably existing, pulling
-- them out of the acquisition funnel and understating every channel's
-- conversion rate.
--
-- The intent of `prior_purchase` is historical trade: a bill from *before the
-- campaign window opened*. Within the window we genuinely cannot distinguish a
-- repeat customer from a first-time buyer, which is exactly why D-37 calls
-- loading sales history the highest-value data addition available.
--
-- Comparing against MIN(campaigns.started_on) — the boundary of the known data
-- window — makes the rule mean what it says:
--
--   * today, with only 19-26 July loaded, nothing predates the window, so no
--     customer is classified prior_purchase;
--   * the moment a 2025 sales export is imported, every customer with an older
--     bill reclassifies automatically on the next recompute, with no migration.

CREATE OR REPLACE FUNCTION recompute_customer_lifecycle()
RETURNS void
LANGUAGE sql
AS $$
  WITH window_start AS (
    -- Start of the earliest campaign we know about, in store-local time.
    SELECT MIN(started_on)::timestamptz AT TIME ZONE 'Asia/Kolkata' AS opens_at
    FROM   campaigns
  ),
  basis AS (
    SELECT
      c.id AS customer_id,
      CASE
        -- Provable: a bill predates the campaign window entirely.
        WHEN EXISTS (
          SELECT 1
          FROM   sales s, window_start w
          WHERE  s.customer_id = c.id
            AND  w.opens_at IS NOT NULL
            AND  s.billed_at < w.opens_at
        ) THEN 'prior_purchase'::lifecycle_basis

        -- The customer told us so on the walk-in form.
        WHEN EXISTS (
          SELECT 1 FROM walkin_submissions ws
          WHERE  ws.customer_id = c.id
            AND  ws.how_did_you_hear = 'Existing Customer'
        ) THEN 'self_declared'::lifecycle_basis

        -- Appears in a lead source → an acquisition target.
        WHEN EXISTS (
          SELECT 1 FROM lead_touches lt WHERE lt.customer_id = c.id
        ) THEN 'lead_matched'::lifecycle_basis

        -- Bought, but matches no lead record at all. Weakest evidence: this
        -- conflates genuine repeat customers with first-time walk-ins who
        -- never filled a form.
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

SELECT recompute_customer_lifecycle();
REFRESH MATERIALIZED VIEW customer_attribution;
