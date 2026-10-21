-- A WalkTrack walk-in is a lead until it converts (drizzle/0026): every walk-in person carries a
-- Lead ID (LED-) from a touch on the fixed "WalkTrack walk-ins" campaign, and gets a Customer ID
-- (CUS-) only once a walk-in of theirs is converted.
--
-- Walk-ins used to link only to people CRM already held; a first-time visitor's number stayed an
-- unlinked string. Now every walk-in with a valid Indian Contact No. has a person in `customers`
-- (as a lead), so it can carry a Lead ID.

INSERT INTO campaigns (name, channel, started_on, notes)
VALUES ('WalkTrack walk-ins', 'walkin', '2026-09-26', 'Store walk-ins logged in WalkTrack: each visitor is a lead until a walk-in converts.')
ON CONFLICT (name, started_on) DO NOTHING;
--> statement-breakpoint
INSERT INTO import_batches (source_type, source_kind, file_name, status, committed_at)
SELECT 'walkin', 'lead', 'walktrack-walk-ins', 'committed', now()
WHERE NOT EXISTS (SELECT 1 FROM import_batches WHERE file_name = 'walktrack-walk-ins' AND source_kind = 'lead');
--> statement-breakpoint

-- Records a walk-in as a lead touch for its person (first visit wins the date); returns the Lead ID.
CREATE OR REPLACE FUNCTION ensure_walkin_lead(cid bigint, visited timestamptz, store bigint) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  campaign int := (SELECT id FROM campaigns WHERE name = 'WalkTrack walk-ins' ORDER BY id LIMIT 1);
  batch uuid := (SELECT id FROM import_batches WHERE file_name = 'walktrack-walk-ins' AND source_kind = 'lead' ORDER BY created_at LIMIT 1);
  code text;
BEGIN
  IF cid IS NULL THEN RETURN NULL; END IF;
  INSERT INTO lead_touches (customer_id, campaign_id, batch_id, channel, touched_at, store_pref_id, raw)
  VALUES (cid, campaign, batch, 'walkin', visited, store, jsonb_build_object('source', 'walktrack'))
  ON CONFLICT (customer_id, campaign_id, channel) DO UPDATE
    SET touched_at = LEAST(lead_touches.touched_at, EXCLUDED.touched_at)
  RETURNING lead_code INTO code;
  -- The Lead ID is assigned by lead_touches' own AFTER INSERT trigger; read it back.
  RETURN COALESCE(code, (SELECT lead_code FROM lead_touches WHERE customer_id = cid AND campaign_id = campaign AND channel = 'walkin'));
END $$;
--> statement-breakpoint

-- A person's Lead ID in every app: the first LED- ever issued to them (campaign, sheet, walk-in or
-- Hemparshwa lead). By issue order, not touch date, so a back-dated touch arriving later never
-- changes a Lead ID people have already seen.
CREATE OR REPLACE FUNCTION person_lead_code(cid bigint) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT lead_code FROM lead_touches WHERE customer_id = cid AND lead_code IS NOT NULL ORDER BY lead_code LIMIT 1
$$;
--> statement-breakpoint

-- Backfill: a person for every walk-in whose Contact No. is a valid Indian mobile CRM did not know yet.
INSERT INTO customers (phone_e164, phone_national, first_seen_at, last_seen_at)
SELECT '+91' || n.national, n.national, min(v.visited_at), max(v.visited_at)
FROM store_visits v
CROSS JOIN LATERAL (SELECT right(regexp_replace(v.external_customer_ref, '\D', '', 'g'), 10) AS national) n
WHERE v.customer_id IS NULL AND v.deleted_at IS NULL AND v.external_customer_ref IS NOT NULL
  AND regexp_replace(v.external_customer_ref, '\D', '', 'g') ~ '^(91)?[6-9][0-9]{9}$'
GROUP BY n.national
ON CONFLICT (phone_e164) DO NOTHING;
--> statement-breakpoint
UPDATE store_visits v SET customer_id = c.id, updated_at = now()
FROM customers c
WHERE v.customer_id IS NULL AND v.external_customer_ref IS NOT NULL
  AND regexp_replace(v.external_customer_ref, '\D', '', 'g') ~ '^(91)?[6-9][0-9]{9}$'
  AND c.phone_national = right(regexp_replace(v.external_customer_ref, '\D', '', 'g'), 10);
--> statement-breakpoint

-- Backfill: a walk-in lead touch (Lead ID) for every walk-in person.
SELECT count(ensure_walkin_lead(customer_id, first_visit, store_id))
FROM (SELECT DISTINCT ON (customer_id) customer_id, visited_at AS first_visit, store_id
      FROM store_visits WHERE customer_id IS NOT NULL AND deleted_at IS NULL
      ORDER BY customer_id, visited_at) firsts;
