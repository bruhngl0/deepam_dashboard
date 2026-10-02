-- Business-facing entity IDs, shared across the Deepam applications.
--
-- CRM owns the customer, lead, vendor, category and store IDs; WalkTrack,
-- Vendor Intelligence and RC Dashboard reuse them. Internal primary keys are
-- untouched, so every foreign key and integration keeps working.
--
-- Generated IDs are fixed-width, zero-padded digits:
--   customer 6 · lead 10 · vendor 5 · category 5 · store 3
-- Manual IDs (campaign, SKU, invoice, salesperson) are entered by people.
--
-- Codes are assigned by an AFTER INSERT trigger rather than a column DEFAULT:
-- the importers upsert, and a DEFAULT nextval() is evaluated for the proposed
-- row even when ON CONFLICT turns it into an update, which would burn the
-- limited 5- and 6-digit ranges on every re-import.

CREATE OR REPLACE FUNCTION assign_public_code() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- TG_ARGV: column, sequence, width
  EXECUTE format(
    'UPDATE %I.%I SET %I = lpad(nextval(%L)::text, %s, ''0'') WHERE id = $1 AND %I IS NULL',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0], TG_ARGV[1], TG_ARGV[2], TG_ARGV[0]
  ) USING NEW.id;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Customers: 6 digits ------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS customers_customer_code_seq MINVALUE 1 MAXVALUE 999999;
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN customer_code text;
--> statement-breakpoint
UPDATE customers c SET customer_code = lpad(n.rn::text, 6, '0')
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM customers) n
WHERE n.id = c.id;
--> statement-breakpoint
SELECT setval('customers_customer_code_seq', GREATEST((SELECT count(*) FROM customers), 1), (SELECT count(*) > 0 FROM customers));
--> statement-breakpoint
ALTER TABLE customers ADD CONSTRAINT customers_customer_code_unique UNIQUE (customer_code);
--> statement-breakpoint
ALTER TABLE customers ADD CONSTRAINT customers_customer_code_format CHECK (customer_code ~ '^[0-9]{6}$');
--> statement-breakpoint
CREATE TRIGGER customers_assign_code AFTER INSERT ON customers
  FOR EACH ROW WHEN (NEW.customer_code IS NULL)
  EXECUTE FUNCTION assign_public_code('customer_code', 'customers_customer_code_seq', '6');
--> statement-breakpoint

-- Leads: 10 digits ---------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS lead_touches_lead_code_seq MINVALUE 1 MAXVALUE 9999999999;
--> statement-breakpoint
ALTER TABLE lead_touches ADD COLUMN lead_code text;
--> statement-breakpoint
UPDATE lead_touches t SET lead_code = lpad(n.rn::text, 10, '0')
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM lead_touches) n
WHERE n.id = t.id;
--> statement-breakpoint
SELECT setval('lead_touches_lead_code_seq', GREATEST((SELECT count(*) FROM lead_touches), 1), (SELECT count(*) > 0 FROM lead_touches));
--> statement-breakpoint
ALTER TABLE lead_touches ADD CONSTRAINT lead_touches_lead_code_unique UNIQUE (lead_code);
--> statement-breakpoint
ALTER TABLE lead_touches ADD CONSTRAINT lead_touches_lead_code_format CHECK (lead_code ~ '^[0-9]{10}$');
--> statement-breakpoint
CREATE TRIGGER lead_touches_assign_code AFTER INSERT ON lead_touches
  FOR EACH ROW WHEN (NEW.lead_code IS NULL)
  EXECUTE FUNCTION assign_public_code('lead_code', 'lead_touches_lead_code_seq', '10');
--> statement-breakpoint

-- Vendors: 5 digits (replaces the old 'VND-001' style codes) ---------------
CREATE SEQUENCE IF NOT EXISTS vendors_vendor_code_seq MINVALUE 1 MAXVALUE 99999;
--> statement-breakpoint
UPDATE vendors v SET vendor_code = lpad(n.rn::text, 5, '0')
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM vendors) n
WHERE n.id = v.id;
--> statement-breakpoint
SELECT setval('vendors_vendor_code_seq', GREATEST((SELECT count(*) FROM vendors), 1), (SELECT count(*) > 0 FROM vendors));
--> statement-breakpoint
ALTER TABLE vendors ADD CONSTRAINT vendors_vendor_code_format CHECK (vendor_code ~ '^[0-9]{5}$');
--> statement-breakpoint
CREATE TRIGGER vendors_assign_code AFTER INSERT ON vendors
  FOR EACH ROW WHEN (NEW.vendor_code IS NULL)
  EXECUTE FUNCTION assign_public_code('vendor_code', 'vendors_vendor_code_seq', '5');
--> statement-breakpoint

-- Stores: 3 digits, fixed by convention in every app ------------------------
CREATE SEQUENCE IF NOT EXISTS stores_store_code_seq MINVALUE 1 MAXVALUE 999;
--> statement-breakpoint
ALTER TABLE stores ADD COLUMN store_code text;
--> statement-breakpoint
UPDATE stores SET store_code = CASE code WHEN 'MG_ROAD' THEN '001' WHEN 'JAYANAGAR' THEN '002' WHEN 'ONLINE' THEN '003' END;
--> statement-breakpoint
UPDATE stores s SET store_code = lpad((3 + n.rn)::text, 3, '0')
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM stores WHERE store_code IS NULL) n
WHERE n.id = s.id;
--> statement-breakpoint
SELECT setval('stores_store_code_seq', GREATEST(3, (SELECT max(store_code::int) FROM stores)));
--> statement-breakpoint
ALTER TABLE stores ADD CONSTRAINT stores_store_code_unique UNIQUE (store_code);
--> statement-breakpoint
ALTER TABLE stores ADD CONSTRAINT stores_store_code_format CHECK (store_code ~ '^[0-9]{3}$');
--> statement-breakpoint
CREATE TRIGGER stores_assign_code AFTER INSERT ON stores
  FOR EACH ROW WHEN (NEW.store_code IS NULL)
  EXECUTE FUNCTION assign_public_code('store_code', 'stores_store_code_seq', '3');
--> statement-breakpoint

-- Campaigns: manual, pre-given ---------------------------------------------
ALTER TABLE campaigns ADD COLUMN campaign_code text;
--> statement-breakpoint
ALTER TABLE campaigns ADD CONSTRAINT campaigns_campaign_code_unique UNIQUE (campaign_code);
--> statement-breakpoint
ALTER TABLE campaigns ADD CONSTRAINT campaigns_campaign_code_format
  CHECK (campaign_code ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,39}$');
--> statement-breakpoint

-- Categories: 5 digits ------------------------------------------------------
-- Categories were free text on purchase orders, demands and the stock ledger's
-- item group. They are registered here automatically whenever a new name
-- appears, so the text columns keep working unchanged.
CREATE SEQUENCE IF NOT EXISTS categories_category_code_seq MINVALUE 1 MAXVALUE 99999;
--> statement-breakpoint
CREATE TABLE categories (
  id serial PRIMARY KEY,
  category_code text UNIQUE CHECK (category_code ~ '^[0-9]{5}$'),
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX categories_name_uidx ON categories (lower(name));
--> statement-breakpoint
CREATE TRIGGER categories_assign_code AFTER INSERT ON categories
  FOR EACH ROW WHEN (NEW.category_code IS NULL)
  EXECUTE FUNCTION assign_public_code('category_code', 'categories_category_code_seq', '5');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION register_category() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  raw text := to_jsonb(NEW) ->> TG_ARGV[0];
BEGIN
  -- TG_ARGV[1] = 'split' for comma-separated lists such as vendors.category_supplied
  INSERT INTO categories (name)
  SELECT DISTINCT trim(part)
  FROM unnest(CASE WHEN TG_ARGV[1] = 'split' THEN string_to_array(raw, ',') ELSE ARRAY[raw] END) AS part
  WHERE nullif(trim(part), '') IS NOT NULL
  ON CONFLICT (lower(name)) DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
INSERT INTO categories (name)
SELECT name FROM (
  SELECT DISTINCT ON (lower(trim(name))) trim(name) AS name, min(src) AS src
  FROM (
    SELECT category AS name, 1 AS src FROM vendor_purchase_orders
    UNION ALL SELECT category, 2 FROM vendor_customer_demands
    UNION ALL SELECT unnest(string_to_array(category_supplied, ',')), 3 FROM vendors
    UNION ALL SELECT item_name, 4 FROM vendor_stock_ledger
    UNION ALL SELECT item_name, 5 FROM sale_line_items
  ) s
  WHERE nullif(trim(name), '') IS NOT NULL
  GROUP BY trim(name)
  ORDER BY lower(trim(name)), min(src)
) d
ORDER BY src, name;
--> statement-breakpoint
CREATE TRIGGER vendor_purchase_orders_register_category AFTER INSERT OR UPDATE OF category ON vendor_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION register_category('category');
--> statement-breakpoint
CREATE TRIGGER vendor_customer_demands_register_category AFTER INSERT OR UPDATE OF category ON vendor_customer_demands
  FOR EACH ROW EXECUTE FUNCTION register_category('category');
--> statement-breakpoint
CREATE TRIGGER vendors_register_category AFTER INSERT OR UPDATE OF category_supplied ON vendors
  FOR EACH ROW EXECUTE FUNCTION register_category('category_supplied', 'split');
--> statement-breakpoint
CREATE TRIGGER vendor_stock_ledger_register_category AFTER INSERT OR UPDATE OF item_name ON vendor_stock_ledger
  FOR EACH ROW EXECUTE FUNCTION register_category('item_name');
--> statement-breakpoint
CREATE TRIGGER sale_line_items_register_category AFTER INSERT OR UPDATE OF item_name ON sale_line_items
  FOR EACH ROW EXECUTE FUNCTION register_category('item_name');
