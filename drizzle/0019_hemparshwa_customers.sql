-- The ERP's Customer Master is imported in Hemparshwa OS, like sales. CRM keeps a
-- copy of the rows each import wrote, as the file gave them (IDs are Hemparshwa's),
-- and fills its own customers from it.
CREATE TABLE hemparshwa_customers (
  import_id integer NOT NULL REFERENCES hemparshwa_imports(import_id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  customer_id text,
  customer_code text,
  name text,
  phone text,
  email text,
  city text,
  store_id text,
  store_name text,
  birth_date date,
  -- As the ERP writes it ("24 Yrs, 6 Month"); CRM shows the date of birth instead.
  age text,
  anniversary_date date,
  gst_no text,
  pan_no text,
  PRIMARY KEY (import_id, row_number)
);
--> statement-breakpoint
CREATE INDEX hemparshwa_customers_phone_idx ON hemparshwa_customers (phone) WHERE phone IS NOT NULL;
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN gst_no text;
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN pan_no text;
