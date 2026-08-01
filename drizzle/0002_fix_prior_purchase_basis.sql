-- Fix: `prior_purchase` was claimed for customers who have no lead touches at
-- all. (D-36, D-38)
--
-- The original used COALESCE(MIN(touched_at), 'infinity'), so when a customer
-- had no touches every bill compared as "earlier than infinity" and the whole
-- set was labelled prior_purchase — the *strongest* basis — when it should have
-- been no_lead_match, the weakest. Caught by scripts/verify-db.ts after the
-- first sales import, where all 650 buyers were mislabelled.
--
-- A purchase can only be "prior" to something. With no touch to be prior to,
-- the correct classification is no_lead_match: bought, but matches no lead
-- record. Comparing against a NULL yields NULL, so EXISTS is false and the
-- CASE falls through correctly.

CREATE OR REPLACE FUNCTION recompute_customer_lifecycle()
RETURNS void
LANGUAGE sql
AS $$
  WITH basis AS (
    SELECT
      c.id AS customer_id,
      CASE
        -- Provable: the customer has a lead touch AND a bill that predates it.
        WHEN EXISTS (
          SELECT 1
          FROM   sales s
          WHERE  s.customer_id = c.id
            AND  s.billed_at < (
                   SELECT MIN(lt.touched_at)
                   FROM   lead_touches lt
                   WHERE  lt.customer_id = c.id)
        ) THEN 'prior_purchase'::lifecycle_basis

        -- The customer told us so on the walk-in form.
        WHEN EXISTS (
          SELECT 1 FROM walkin_submissions w
          WHERE  w.customer_id = c.id
            AND  w.how_did_you_hear = 'Existing Customer'
        ) THEN 'self_declared'::lifecycle_basis

        -- Appears in a lead source → an acquisition target.
        WHEN EXISTS (
          SELECT 1 FROM lead_touches lt WHERE lt.customer_id = c.id
        ) THEN 'lead_matched'::lifecycle_basis

        -- Bought, but matches no lead record at all. Weakest evidence: this
        -- conflates genuine repeat customers with first-time walk-ins who
        -- never filled a form. Resolved provably once sales history is loaded.
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

-- Reclassify everything already imported under the broken rule.
SELECT recompute_customer_lifecycle();
