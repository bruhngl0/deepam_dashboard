-- Hemparshwa OS is where source files are imported. CRM keeps a copy of what it
-- imported, in Hemparshwa's own shape, and pulls it over the integration feed.
-- The IDs in these tables (store_id, customer_id, vendor_id, category_id) are
-- Hemparshwa's, not CRM's.
CREATE TABLE hemparshwa_imports (
  import_id integer PRIMARY KEY,
  source text NOT NULL,
  data_type text NOT NULL,
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  rows_imported integer NOT NULL,
  imported_at timestamptz NOT NULL,
  period_from date,
  period_to date,
  version text NOT NULL,
  rows_synced integer NOT NULL,
  -- The CRM import batch its bills and line items are filed under; set when they are built.
  batch_id uuid REFERENCES import_batches(id),
  synced_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE hemparshwa_sales_lines (
  import_id integer NOT NULL REFERENCES hemparshwa_imports(import_id) ON DELETE CASCADE,
  store_id text NOT NULL,
  store_name text NOT NULL,
  invoice_id text NOT NULL,
  invoice_date date NOT NULL,
  -- Lower-case, '' when the source has none. A voucher number is reused across the POS's
  -- series and for returns, so the document is number + date + sales type.
  sales_type text NOT NULL,
  invoice_line_id text NOT NULL,
  sku_code text NOT NULL,
  sku_name text,
  category_id text,
  category text,
  subcategory text,
  vendor_id text,
  vendor text,
  customer_id text,
  customer_name text,
  customer_phone text,
  salesperson text,
  quantity numeric(14, 2) NOT NULL,
  selling_price numeric(14, 2) NOT NULL,
  discount numeric(14, 2) NOT NULL,
  net_amount numeric(14, 2) NOT NULL,
  cogs numeric(14, 2),
  details jsonb NOT NULL,
  PRIMARY KEY (store_id, invoice_id, invoice_date, sales_type, invoice_line_id)
);
--> statement-breakpoint
CREATE INDEX hemparshwa_sales_lines_import_idx ON hemparshwa_sales_lines (import_id);
--> statement-breakpoint
CREATE INDEX hemparshwa_sales_lines_date_idx ON hemparshwa_sales_lines (invoice_date);
--> statement-breakpoint
CREATE INDEX hemparshwa_sales_lines_phone_idx ON hemparshwa_sales_lines (customer_phone) WHERE customer_phone IS NOT NULL;
--> statement-breakpoint
CREATE INDEX hemparshwa_sales_lines_sku_idx ON hemparshwa_sales_lines (sku_code);
