-- Entity IDs take one prefixed format in every Deepam application:
--   customer CUS-000001 · vendor VEN-000001 · lead LED-000001
--   category CAT-0001 · store STR-001 · driver DRV-00001 (RC Dashboard's)
--
-- The numbers assigned by 0015 are kept; only the prefix and width change
-- (vendor 5 -> 6 digits, lead 10 -> 6, category 5 -> 4). Internal primary keys
-- are untouched.

-- Lead and Category IDs get narrower. Stop here, before anything is rewritten,
-- if the numbers already issued would not fit.
DO $$
BEGIN
  IF (SELECT max(lead_code::bigint) FROM lead_touches) > 999999 THEN
    RAISE EXCEPTION 'lead_touches holds more than 999999 Lead IDs; LED-000001 cannot represent them';
  END IF;
  IF (SELECT max(category_code::bigint) FROM categories) > 9999 THEN
    RAISE EXCEPTION 'categories holds more than 9999 Category IDs; CAT-0001 cannot represent them';
  END IF;
END $$;
--> statement-breakpoint

-- TG_ARGV: column, sequence, width, prefix
CREATE OR REPLACE FUNCTION assign_public_code() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'UPDATE %I.%I SET %I = %L || lpad(nextval(%L)::text, %s, ''0'') WHERE id = $1 AND %I IS NULL',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_ARGV[0], TG_ARGV[3], TG_ARGV[1], TG_ARGV[2], TG_ARGV[0]
  ) USING NEW.id;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Customers: CUS-000001 ----------------------------------------------------
DROP TRIGGER customers_assign_code ON customers;
--> statement-breakpoint
ALTER TABLE customers DROP CONSTRAINT customers_customer_code_format;
--> statement-breakpoint
UPDATE customers SET customer_code = 'CUS-' || customer_code WHERE customer_code ~ '^[0-9]{6}$';
--> statement-breakpoint
ALTER TABLE customers ADD CONSTRAINT customers_customer_code_format CHECK (customer_code ~ '^CUS-[0-9]{6}$');
--> statement-breakpoint
CREATE TRIGGER customers_assign_code AFTER INSERT ON customers
  FOR EACH ROW WHEN (NEW.customer_code IS NULL)
  EXECUTE FUNCTION assign_public_code('customer_code', 'customers_customer_code_seq', '6', 'CUS-');
--> statement-breakpoint

-- Leads: LED-000001 --------------------------------------------------------
DROP TRIGGER lead_touches_assign_code ON lead_touches;
--> statement-breakpoint
ALTER TABLE lead_touches DROP CONSTRAINT lead_touches_lead_code_format;
--> statement-breakpoint
UPDATE lead_touches SET lead_code = 'LED-' || lpad(lead_code::bigint::text, 6, '0') WHERE lead_code ~ '^[0-9]{10}$';
--> statement-breakpoint
ALTER SEQUENCE lead_touches_lead_code_seq MAXVALUE 999999;
--> statement-breakpoint
ALTER TABLE lead_touches ADD CONSTRAINT lead_touches_lead_code_format CHECK (lead_code ~ '^LED-[0-9]{6}$');
--> statement-breakpoint
CREATE TRIGGER lead_touches_assign_code AFTER INSERT ON lead_touches
  FOR EACH ROW WHEN (NEW.lead_code IS NULL)
  EXECUTE FUNCTION assign_public_code('lead_code', 'lead_touches_lead_code_seq', '6', 'LED-');
--> statement-breakpoint

-- Vendors: VEN-000001 ------------------------------------------------------
DROP TRIGGER vendors_assign_code ON vendors;
--> statement-breakpoint
ALTER TABLE vendors DROP CONSTRAINT vendors_vendor_code_format;
--> statement-breakpoint
UPDATE vendors SET vendor_code = 'VEN-' || lpad(vendor_code::int::text, 6, '0') WHERE vendor_code ~ '^[0-9]{5}$';
--> statement-breakpoint
ALTER SEQUENCE vendors_vendor_code_seq MAXVALUE 999999;
--> statement-breakpoint
ALTER TABLE vendors ADD CONSTRAINT vendors_vendor_code_format CHECK (vendor_code ~ '^VEN-[0-9]{6}$');
--> statement-breakpoint
CREATE TRIGGER vendors_assign_code AFTER INSERT ON vendors
  FOR EACH ROW WHEN (NEW.vendor_code IS NULL)
  EXECUTE FUNCTION assign_public_code('vendor_code', 'vendors_vendor_code_seq', '6', 'VEN-');
--> statement-breakpoint

-- Categories: CAT-0001 -----------------------------------------------------
DROP TRIGGER categories_assign_code ON categories;
--> statement-breakpoint
ALTER TABLE categories DROP CONSTRAINT categories_category_code_check;
--> statement-breakpoint
UPDATE categories SET category_code = 'CAT-' || lpad(category_code::int::text, 4, '0') WHERE category_code ~ '^[0-9]{5}$';
--> statement-breakpoint
ALTER SEQUENCE categories_category_code_seq MAXVALUE 9999;
--> statement-breakpoint
ALTER TABLE categories ADD CONSTRAINT categories_category_code_format CHECK (category_code ~ '^CAT-[0-9]{4}$');
--> statement-breakpoint
CREATE TRIGGER categories_assign_code AFTER INSERT ON categories
  FOR EACH ROW WHEN (NEW.category_code IS NULL)
  EXECUTE FUNCTION assign_public_code('category_code', 'categories_category_code_seq', '4', 'CAT-');
--> statement-breakpoint

-- store_visits.driver_code is left as WalkTrack sent it. Older visits hold the
-- number staff typed, which RC Dashboard reads as either a Driver ID or a
-- legacy RC number, so it cannot be rewritten to DRV-00001 safely. WalkTrack
-- sends the full Driver ID from now on.

-- Stores: STR-001 MG Road, STR-002 Jayanagar, STR-003 Online ----------------
DROP TRIGGER stores_assign_code ON stores;
--> statement-breakpoint
ALTER TABLE stores DROP CONSTRAINT stores_store_code_format;
--> statement-breakpoint
UPDATE stores SET store_code = 'STR-' || store_code WHERE store_code ~ '^[0-9]{3}$';
--> statement-breakpoint
ALTER TABLE stores ADD CONSTRAINT stores_store_code_format CHECK (store_code ~ '^STR-[0-9]{3}$');
--> statement-breakpoint
CREATE TRIGGER stores_assign_code AFTER INSERT ON stores
  FOR EACH ROW WHEN (NEW.store_code IS NULL)
  EXECUTE FUNCTION assign_public_code('store_code', 'stores_store_code_seq', '3', 'STR-');
