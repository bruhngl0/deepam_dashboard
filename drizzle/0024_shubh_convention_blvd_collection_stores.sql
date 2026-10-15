-- Two more stores for WalkTrack walk-ins: STR-004 Shubh Convention (POS bill prefix BK004-)
-- and STR-005 BLVD Collection (BK005-). Store IDs are fixed by convention in every app, so
-- they are set here rather than left to the trigger.
INSERT INTO stores (code, store_code, name, voucher_prefix) VALUES
  ('SHUBH_CONVENTION', 'STR-004', 'Shubh Convention', 'BK004-'),
  ('BLVD_COLLECTION', 'STR-005', 'BLVD Collection', 'BK005-')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
SELECT setval('stores_store_code_seq', GREATEST(5, (SELECT max(substring(store_code from 5)::int) FROM stores)));
