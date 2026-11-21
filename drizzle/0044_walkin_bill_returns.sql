-- What came back from each bill, and the bill of a walk-in whose purchase was fully returned.
-- The ERP does not link a return to its bill: lib/integration/allocate-returns.ts traces it by barcode.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "returned_amount" numeric(14, 2) NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "fully_returned" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "store_visits" ADD COLUMN IF NOT EXISTS "returned_sale_id" bigint REFERENCES "sales"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_visits_returned_sale_idx" ON "store_visits" ("returned_sale_id") WHERE "returned_sale_id" IS NOT NULL;
