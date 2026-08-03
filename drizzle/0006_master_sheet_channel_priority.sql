-- Re-rank first-touch precedence for the master-sheet channel set. (D-85)
--
-- The walk-in channel no longer exists: the cleaned master workbook dissolved
-- it and redistributed its 741 people across Meta, WhatsApp, Google Ads and
-- Others. The old CASE still ranked 'walkin' first and left 'google' and
-- 'other' sharing the ELSE bucket, so a person appearing in both Google Ads
-- and Others had their channel decided by whatever order the planner happened
-- to return — a non-deterministic result in a materialized view.
--
-- The bigger change is that rule 1 is now dead. The master workbook carries no
-- dates at all, so *every* touch is flagged touched_at_is_estimated and the
-- real-beats-estimated test can never fire. Channel priority is no longer a
-- tiebreak of last resort; it is the whole decision. It is stated explicitly
-- here and mirrored in settings.channel_priority.
--
--   google    most specific: a tiny, hand-verified paid list
--   meta      paid acquisition with per-lead identity
--   other     store-sourced; no campaign of origin recorded
--   whatsapp  a broadcast to a purchased list — weakest claim to origin
--
-- Once any export carries a real timestamp, rule 1 starts firing again on its
-- own and this ordering recedes to breaking genuine ties.

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
            lt.touched_at_is_estimated ASC,   -- real evidence first
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
            lt.campaign_id                    -- total order: never planner-dependent
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
SET    value = '["google", "meta", "other", "whatsapp"]'::jsonb,
       description = 'First-touch precedence. With no dated exports this decides every overlap, not just ties.',
       updated_at = now()
WHERE  key = 'channel_priority';
