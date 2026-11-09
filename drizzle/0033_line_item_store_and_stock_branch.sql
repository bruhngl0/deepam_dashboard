-- Sales lines keep their store, sale type, salespeople, vendor, phone and purchase details as columns, and the stock
-- ledger keeps a row per barcode per branch with the Stock Report's descriptive columns (MRP, purchase date, …).
-- Fabric (sold by the metre) is not tracked as stock: any fabric rows already in the ledger are removed.
-- Existing rows are filled from what each already holds; every column is new, so nothing is overwritten.

-- ── sale_line_items ─────────────────────────────────────────────────────────
ALTER TABLE sale_line_items
  ADD COLUMN IF NOT EXISTS store_id integer REFERENCES stores(id),
  ADD COLUMN IF NOT EXISTS sales_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS salesperson text,
  ADD COLUMN IF NOT EXISTS helper text,
  ADD COLUMN IF NOT EXISTS vendor text,
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS vendor_invoice_no text;
--> statement-breakpoint
-- Store from the bill a line belongs to; the rest from the source row it was built from: Hemparshwa's mapped
-- fields for lines built from Hemparshwa, the sheet's own headings for lines imported from the file.
UPDATE sale_line_items li SET store_id = s.store_id FROM sales s WHERE s.id = li.sale_id AND li.store_id IS NULL;
--> statement-breakpoint
UPDATE sale_line_items SET
  salesperson = COALESCE(salesperson, NULLIF(trim(COALESCE(raw->>'employee', raw->>'Salesman Name')), '')),
  helper = COALESCE(helper, NULLIF(trim(COALESCE(raw->>'employee2', raw->>'Helper Name')), '')),
  vendor = COALESCE(vendor, NULLIF(trim(COALESCE(raw->>'vendor', raw->>'Party Name')), '')),
  customer_phone = COALESCE(customer_phone, NULLIF(trim(COALESCE(raw->>'customer_phone', raw->>'Mobile1')), '')),
  vendor_invoice_no = COALESCE(vendor_invoice_no, NULLIF(trim(COALESCE(raw->>'vendor_invoice_number', raw->>'Purc BillNo')), '')),
  purchase_date = COALESCE(purchase_date, CASE WHEN raw->>'purchase_date' ~ '^\d{4}-\d{2}-\d{2}' THEN substr(raw->>'purchase_date', 1, 10)::date END);
--> statement-breakpoint
-- Hemparshwa's lines carry their sale type in the bill they belong to ('…@2026-05-04-return'); a plain sale is ''.
UPDATE sale_line_items li SET sales_type = substring(s.voucher_no FROM '@\d{4}-\d{2}-\d{2}-(.+)$')
FROM sales s WHERE s.id = li.sale_id AND li.sales_type = '' AND s.voucher_no ~ '@\d{4}-\d{2}-\d{2}-.+$';
--> statement-breakpoint
-- Voucher numbers repeat across stores, so a line is store + voucher + date + type + barcode.
ALTER TABLE sale_line_items DROP CONSTRAINT IF EXISTS sale_line_items_identity_key;
--> statement-breakpoint
ALTER TABLE sale_line_items ADD CONSTRAINT sale_line_items_identity_key
  UNIQUE NULLS NOT DISTINCT (voucher_date_raw, voucher_no_raw, barcode, store_id, sales_type);
--> statement-breakpoint
DROP INDEX IF EXISTS sale_line_items_identity_idx;
--> statement-breakpoint

-- ── vendor_stock_ledger ─────────────────────────────────────────────────────
ALTER TABLE vendor_stock_ledger
  ADD COLUMN IF NOT EXISTS branch text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS store_id integer REFERENCES stores(id),
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS product text,
  ADD COLUMN IF NOT EXISTS style text,
  ADD COLUMN IF NOT EXISTS design_no text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS size text,
  ADD COLUMN IF NOT EXISTS lot_no text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS mrp numeric(12, 2),
  ADD COLUMN IF NOT EXISTS purchase_voucher text,
  ADD COLUMN IF NOT EXISTS purchase_date date;
--> statement-breakpoint
UPDATE vendor_stock_ledger SET
  branch = COALESCE(NULLIF(trim(COALESCE(raw->>'Branch', raw->>'Branch Name')), ''), ''),
  department = NULLIF(trim(raw->>'Department'), ''),
  brand = NULLIF(trim(COALESCE(raw->>'Brand', raw->>'Brand Name')), ''),
  product = NULLIF(trim(raw->>'Product'), ''),
  style = NULLIF(trim(raw->>'Style'), ''),
  design_no = NULLIF(trim(COALESCE(raw->>'Design', raw->>'Design No')), ''),
  color = NULLIF(trim(COALESCE(raw->>'Color', raw->>'Colour')), ''),
  size = NULLIF(trim(COALESCE(raw->>'Size1', raw->>'Size')), ''),
  lot_no = NULLIF(trim(raw->>'Lot No'), ''),
  city = NULLIF(trim(raw->>'City'), ''),
  mrp = CASE WHEN raw->>'MRP' ~ '^-?\d+(\.\d+)?$' THEN (raw->>'MRP')::numeric END,
  purchase_voucher = NULLIF(trim(raw->>'Voucher'), ''),
  purchase_date = CASE WHEN raw->>'Voucher Date' ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(raw->>'Voucher Date', 'DD/MM/YYYY') END
WHERE branch = '' AND store_id IS NULL;
--> statement-breakpoint
UPDATE vendor_stock_ledger l SET store_id = st.id
FROM stores st
WHERE l.store_id IS NULL AND l.branch <> ''
  AND st.code = CASE upper(regexp_replace(l.branch, '[^A-Za-z0-9]', '', 'g')) WHEN 'MG' THEN 'MG_ROAD' WHEN 'MGROAD' THEN 'MG_ROAD'
                ELSE upper(regexp_replace(l.branch, '[^A-Za-z0-9]+', '_', 'g')) END;
--> statement-breakpoint
DELETE FROM vendor_stock_ledger
WHERE upper(coalesce(department, '')) = 'FABRIC' OR upper(coalesce(product, '')) = 'FABRICS' OR upper(coalesce(item_name, '')) LIKE 'FABRICS%';
--> statement-breakpoint
-- The Stock Report lists a barcode once per branch it passed through.
DROP INDEX IF EXISTS vendor_stock_ledger_identity_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX vendor_stock_ledger_identity_idx ON vendor_stock_ledger (barcode, branch, period_from, period_to);
