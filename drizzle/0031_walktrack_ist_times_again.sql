-- 0030 ran while the previous release was still live: walk-ins WalkTrack re-sent in those minutes
-- (after their bill changed) were stored 5h30 late again. The same correction, now that every
-- release reads WalkTrack times as IST.

-- WalkTrack's start and stop times are the store's clock time (IST), sent with no offset. They
-- were read as UTC, so every walk-in sat 5h30 late, and one after 18:30 IST fell on the next day.
-- Recompute each from the time WalkTrack sent (kept in store_visits.raw); running this again
-- changes nothing. Then fix what was copied from those times, and re-match bills by the true day.

CREATE TEMP TABLE walktrack_time_fix ON COMMIT DROP AS
SELECT id, customer_id, visited_at AS old_at,
  ((raw->>'startTime')::timestamp AT TIME ZONE 'Asia/Kolkata') AS new_at,
  CASE WHEN raw->>'stopTime' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+$'
    THEN (raw->>'stopTime')::timestamp AT TIME ZONE 'Asia/Kolkata' ELSE stopped_at END AS new_stop
FROM store_visits
WHERE source_system = 'walktrack' AND raw->>'startTime' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+$';
--> statement-breakpoint

-- A person's first and last seen times that came from a walk-in.
UPDATE customers c SET first_seen_at = f.new_at
FROM walktrack_time_fix f
WHERE f.customer_id = c.id AND c.first_seen_at = f.old_at AND f.old_at <> f.new_at;
--> statement-breakpoint
UPDATE customers c SET last_seen_at = f.new_at
FROM walktrack_time_fix f
WHERE f.customer_id = c.id AND c.last_seen_at = f.old_at AND f.old_at <> f.new_at;
--> statement-breakpoint

-- The walk-in lead touch is dated by the person's first walk-in.
UPDATE lead_touches lt SET touched_at = m.new_first
FROM (
  SELECT f.customer_id, min(f.old_at) AS old_first, min(f.new_at) AS new_first
  FROM walktrack_time_fix f JOIN store_visits sv ON sv.id = f.id AND sv.deleted_at IS NULL
  WHERE f.customer_id IS NOT NULL GROUP BY f.customer_id
) m
WHERE lt.customer_id = m.customer_id AND lt.channel = 'walkin' AND lt.raw->>'source' = 'walktrack'
  AND lt.touched_at = m.old_first AND m.old_first <> m.new_first;
--> statement-breakpoint

UPDATE store_visits sv SET visited_at = f.new_at, stopped_at = f.new_stop, updated_at = now()
FROM walktrack_time_fix f
WHERE sv.id = f.id AND (sv.visited_at IS DISTINCT FROM f.new_at OR sv.stopped_at IS DISTINCT FROM f.new_stop);
--> statement-breakpoint

-- A bill matched on the wrong day is let go; matching below finds the right one.
UPDATE store_visits sv SET pos_sale_id = NULL, updated_at = now()
FROM sales s
WHERE s.id = sv.pos_sale_id AND sv.source_system = 'walktrack'
  AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date <> (sv.visited_at AT TIME ZONE 'Asia/Kolkata')::date;
--> statement-breakpoint

-- Same matching as reconcileStoreVisits(): customer, store and IST day agree, nearest time wins,
-- one visit per bill.
WITH candidates AS (
  SELECT sv.id AS visit_id, s.id AS sale_id,
    ROW_NUMBER() OVER (PARTITION BY sv.id ORDER BY ABS(EXTRACT(EPOCH FROM (s.billed_at - sv.visited_at))), s.id) AS visit_rank,
    ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY ABS(EXTRACT(EPOCH FROM (s.billed_at - sv.visited_at))), sv.id) AS sale_rank
  FROM store_visits sv
  JOIN sales s ON s.customer_id = sv.customer_id AND s.store_id = sv.store_id
    AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date = (sv.visited_at AT TIME ZONE 'Asia/Kolkata')::date
  WHERE sv.deleted_at IS NULL AND sv.customer_id IS NOT NULL AND sv.pos_sale_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM store_visits taken WHERE taken.pos_sale_id = s.id)
), chosen AS (
  SELECT visit_id, sale_id FROM candidates WHERE visit_rank = 1 AND sale_rank = 1
)
UPDATE store_visits sv SET pos_sale_id = chosen.sale_id, updated_at = now()
FROM chosen WHERE sv.id = chosen.visit_id;
