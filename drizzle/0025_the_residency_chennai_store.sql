-- STR-006 The Residency-Chennai, for WalkTrack walk-ins. Its POS bill prefix is not known yet, so
-- voucher_prefix stays empty until it is. Store IDs are fixed by convention in every app.
INSERT INTO stores (code, store_code, name) VALUES ('THE_RESIDENCY_CHENNAI', 'STR-006', 'The Residency-Chennai')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
SELECT setval('stores_store_code_seq', GREATEST(6, (SELECT max(substring(store_code from 5)::int) FROM stores)));
