-- Fix: an estimated touch timestamp must not win a first-touch comparison
-- against a real one. (D-30, D-44)
--
-- Meta and WhatsApp exports carry no per-lead date, so every touch from those
-- channels is stamped with campaign.started_on and flagged
-- touched_at_is_estimated. Walk-in submissions carry a real timestamp.
--
-- Ordering purely by touched_at therefore let a placeholder 19-July stamp beat
-- a measured 22-July walk-in, handing Meta 59 customers and 43 conversions
-- that belong to the walk-in channel. The placeholder is not evidence that the
-- Meta touch came first; it is an admission that we do not know when it came.
--
-- Correct precedence:
--   1. a real timestamp beats an estimated one          (evidence beats guess)
--   2. among comparable touches, earliest wins           (D-44)
--   3. ties break on channel priority                    (D-44)
--
-- Restores the documented split: walk-in 598 / meta 1,656 / whatsapp 3,469.
-- Once Meta exports include `created_time`, rule 1 stops firing on its own.

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
