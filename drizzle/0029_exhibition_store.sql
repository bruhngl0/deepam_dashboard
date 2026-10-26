-- STR-007 Exhibition: sales the ERP exports under Branch Name EXHIBITION, which Hemparshwa OS
-- holds as store EXHIBITION. CRM store IDs must be STR-###, so the Hemparshwa sync matches this
-- store by its code (EXHIBITION) instead.
INSERT INTO stores (code, store_code, name, voucher_prefix) VALUES ('EXHIBITION', 'STR-007', 'Exhibition', 'EXHB-')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
SELECT setval('stores_store_code_seq', GREATEST(7, (SELECT max(substring(store_code from 5)::int) FROM stores)));
