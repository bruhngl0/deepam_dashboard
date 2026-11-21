-- Documents the ERP export contains but that are not sales (wholesale). The imported lines are kept; they just do not count.
CREATE TABLE IF NOT EXISTS "sales_excluded_documents" (
  "store_id" text NOT NULL,
  "invoice_id" text NOT NULL,
  "invoice_date" date NOT NULL,
  "sales_type" text NOT NULL,
  "reason" text NOT NULL,
  PRIMARY KEY ("store_id", "invoice_id", "invoice_date", "sales_type")
);--> statement-breakpoint
INSERT INTO "sales_excluded_documents" VALUES ('STR-001', '00027', '2026-11-19', 'sales', 'MG Road wholesale bill')
ON CONFLICT DO NOTHING;
