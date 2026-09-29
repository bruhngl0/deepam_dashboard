\set ON_ERROR_STOP on
BEGIN;

INSERT INTO customers (phone_e164,phone_national,full_name,name_source,first_seen_at,last_seen_at)
VALUES ('+919876543210','9876543210','Integration Test Customer','test','2026-09-26 10:00+05:30','2026-09-26 10:00+05:30');

INSERT INTO integration_inbox(event_id,source,event_type,entity_id,payload,occurred_at)
VALUES ('11111111-1111-4111-8111-111111111111','walktrack','walkin.created','walkin-e2e-1','{}','2026-09-26 11:00+05:30')
ON CONFLICT (event_id) DO NOTHING;
INSERT INTO integration_inbox(event_id,source,event_type,entity_id,payload,occurred_at)
VALUES ('11111111-1111-4111-8111-111111111111','walktrack','walkin.created','walkin-e2e-1','{}','2026-09-26 11:00+05:30')
ON CONFLICT (event_id) DO NOTHING;

DO $$ BEGIN
  IF (SELECT COUNT(*) FROM integration_inbox WHERE event_id='11111111-1111-4111-8111-111111111111') <> 1
  THEN RAISE EXCEPTION 'integration inbox did not deduplicate'; END IF;
END $$;

INSERT INTO store_visits(source_system,external_id,store_id,customer_id,external_customer_ref,visited_at,stopped_at,staff_converted,people,raw,source_updated_at)
SELECT 'walktrack','walkin-e2e-1',s.id,c.id,'9876543210','2026-09-26 11:00+05:30','2026-09-26 11:45+05:30',true,2,'{}','2026-09-26 11:45+05:30'
FROM stores s CROSS JOIN customers c WHERE s.code='MG_ROAD' AND c.phone_national='9876543210';

INSERT INTO import_batches(id,source_type,source_kind,file_name,status,rows_total,rows_ok,committed_at)
VALUES ('22222222-2222-4222-8222-222222222222','existing','sale','local-test.xlsx','committed',1,1,now());
INSERT INTO sales(voucher_no,batch_id,store_id,billed_at,customer_id,bill_amount,payments,raw)
SELECT 'BK01-E2E','22222222-2222-4222-8222-222222222222',s.id,'2026-09-26 11:37+05:30',c.id,12500,'{}','{}'
FROM stores s CROSS JOIN customers c WHERE s.code='MG_ROAD' AND c.phone_national='9876543210';

WITH candidates AS (
  SELECT sv.id AS visit_id,s.id AS sale_id,
    ROW_NUMBER() OVER (PARTITION BY sv.id ORDER BY ABS(EXTRACT(EPOCH FROM (s.billed_at-sv.visited_at))),s.id) visit_rank,
    ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY ABS(EXTRACT(EPOCH FROM (s.billed_at-sv.visited_at))),sv.id) sale_rank
  FROM store_visits sv JOIN sales s ON s.customer_id=sv.customer_id AND s.store_id=sv.store_id
    AND (s.billed_at AT TIME ZONE 'Asia/Kolkata')::date=(sv.visited_at AT TIME ZONE 'Asia/Kolkata')::date
  WHERE sv.deleted_at IS NULL AND sv.pos_sale_id IS NULL
), chosen AS (SELECT visit_id,sale_id FROM candidates WHERE visit_rank=1 AND sale_rank=1)
UPDATE store_visits sv SET pos_sale_id=chosen.sale_id FROM chosen WHERE sv.id=chosen.visit_id;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM store_visits sv JOIN sales s ON s.id=sv.pos_sale_id WHERE sv.external_id='walkin-e2e-1' AND s.voucher_no='BK01-E2E')
  THEN RAISE EXCEPTION 'sale was not reconciled to visit'; END IF;
END $$;

ROLLBACK;
\echo 'CRM integration inbox, visit projection and sale reconciliation passed'
