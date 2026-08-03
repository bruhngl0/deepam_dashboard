-- Enforce the attribution window (D-45).
--
-- `attribution_window_days` was seeded in migration 0001 and documented in
-- DECISIONS.md as the rule "a sale counts as a conversion if billed_at >=
-- first_touch_at and within the window" — but no query, migration or view
-- ever read it. sale_agg summed a customer's entire lifetime spend regardless
-- of when the campaign that first touched them ran. Harmless while every bill
-- and every touch sit inside one seven-day load; wrong the moment a July lead
-- buys again in November and that November bill gets credited to a July
-- campaign that had nothing to do with it.
--
-- The fix changes what "converted" means for a lead-matched customer: their
-- bill_count/total_sales/converted/first_sale_at now come only from sales
-- inside [first_touch_at, first_touch_at + attribution_window_days). A sale
-- outside that window still happened and is still counted in `sales` and in
-- gross revenue — it simply stops being credited to that person's first-touch
-- campaign, the same way D-43 already stops crediting a repeat customer's
-- spend to whichever campaign happened to catch them.
--
-- Existing customers are explicitly exempt, not windowed to zero. They have
-- no first_touch_at at all (D-36 — that absence is what makes them existing),
-- so "sales within N days of first touch" is not a question that has an
-- answer for them. Their revenue stays their full lifetime spend, matched by
-- `ft.customer_id IS NULL` in sale_agg's join.
--
-- The window is read from settings at REFRESH time via a scalar subquery, not
-- hardcoded, so the setting stays the single source of truth for its own
-- value — unlike migration 0006's channel-priority CASE, which is duplicated
-- into application code with a comment asking it be kept in step, this value
-- has exactly one reader and can afford to just point at the row.
--
-- Verified before writing this: today, zero bills predate their customer's
-- first touch and zero conversions land more than 30 days after it, so this
-- migration changes no number currently on screen — it only starts binding
-- the moment a second campaign period lands in the same database.

DROP MATERIALIZED VIEW IF EXISTS customer_attribution;

CREATE MATERIALIZED VIEW customer_attribution AS
WITH first_touch AS (
  SELECT DISTINCT ON (lt.customer_id)
         lt.customer_id,
         lt.campaign_id,
         lt.channel,
         lt.touched_at
  FROM   lead_touches lt
  ORDER  BY lt.customer_id,
            lt.touched_at_is_estimated ASC,
            lt.touched_at ASC,
            CASE lt.channel
              WHEN 'google'   THEN 1
              WHEN 'meta'     THEN 2
              WHEN 'other'    THEN 3
              WHEN 'whatsapp' THEN 4
              WHEN 'referral' THEN 5
              WHEN 'walkin'   THEN 6
              ELSE 7
            END,
            lt.campaign_id
),
sale_agg AS (
  SELECT s.customer_id,
         COUNT(*)           AS bill_count,
         SUM(s.bill_amount) AS total_sales,
         MIN(s.billed_at)   AS first_sale_at,
         MAX(s.billed_at)   AS last_sale_at
  FROM   sales s
  LEFT   JOIN first_touch ft ON ft.customer_id = s.customer_id
  WHERE  s.customer_id IS NOT NULL
    AND (
      ft.customer_id IS NULL  -- existing customer: no window to apply, count everything
      OR (
        s.billed_at >= ft.touched_at
        AND s.billed_at < ft.touched_at + (
          (SELECT (value #>> '{}')::int FROM settings WHERE key = 'attribution_window_days')
          * INTERVAL '1 day'
        )
      )
    )
  GROUP  BY s.customer_id
)
SELECT
  c.id AS customer_id,
  CASE
    WHEN c.lifecycle = 'existing' THEN 'existing'::channel
    ELSE COALESCE(ft.channel, 'existing'::channel)
  END AS primary_channel,
  CASE WHEN c.lifecycle = 'existing' THEN NULL ELSE ft.campaign_id END
    AS primary_campaign_id,
  ft.touched_at AS first_touch_at,
  c.lifecycle,
  c.lifecycle_basis,
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

CREATE UNIQUE INDEX customer_attribution_pk
  ON customer_attribution (customer_id);
CREATE INDEX customer_attribution_channel_idx
  ON customer_attribution (primary_channel, converted);
CREATE INDEX customer_attribution_funnel_idx
  ON customer_attribution (lifecycle, in_acquisition_funnel);

UPDATE settings
SET    description = 'Days after first touch within which a sale counts as a conversion (D-45). Enforced in customer_attribution.sale_agg since migration 0007 — previously seeded but unread.',
       updated_at = now()
WHERE  key = 'attribution_window_days';
