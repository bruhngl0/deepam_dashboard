-- Internal accounts: the store's own, staff and test numbers that the ERP bills or lists like customers
-- (e.g. "DEEPAM GROUND FLOOR DISPLAY"). They stay people in the CRM, but their bills never count for a
-- customer, and they are kept off marketing conversions and calling lists. Add a number with:
--   INSERT INTO internal_accounts (phone_e164, label) VALUES ('+91…', 'why') ON CONFLICT DO NOTHING;
-- then run the cleanup at the end of this file again.
CREATE TABLE IF NOT EXISTS internal_accounts (
  phone_e164 text PRIMARY KEY,
  label text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO internal_accounts (phone_e164, label) VALUES
  ('+919886041100', 'DEEPAM GROUND FLOOR DISPLAY: display stock account'),
  ('+919886000096', 'Vijayashekar Ravi Deepam: owner'),
  ('+916363061764', 'JYOTHI S (STAFF)'),
  ('+917349243470', 'AMRUTHA (STAFF)'),
  ('+919060661818', 'Deepam: store number'),
  ('+918040908855', 'Deepam silks: store landline'),
  ('+918095901377', 'DEEPAM: store number'),
  ('+919632961588', 'Deepam Facebook: marketing entry'),
  ('+917829600173', 'Vijay admin'),
  ('+918381282954', 'Test Test: test lead'),
  ('+919602791294', 'Test Test: test lead'),
  ('+919827398489', 'Test p: test lead'),
  ('+919920000000', 'John Doe: test lead')
ON CONFLICT (phone_e164) DO NOTHING;
--> statement-breakpoint
-- A bill from an internal account is kept, but on no customer, whichever import writes it.
CREATE OR REPLACE FUNCTION sales_skip_internal_accounts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM customers c JOIN internal_accounts i ON i.phone_e164 = c.phone_e164 WHERE c.id = NEW.customer_id
  ) THEN
    NEW.customer_id := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sales_skip_internal_accounts ON sales;
--> statement-breakpoint
CREATE TRIGGER sales_skip_internal_accounts BEFORE INSERT OR UPDATE OF customer_id ON sales
  FOR EACH ROW EXECUTE FUNCTION sales_skip_internal_accounts();
--> statement-breakpoint
-- Marketing conversions and calling lists skip internal accounts.
CREATE OR REPLACE FUNCTION skip_internal_phone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM internal_accounts WHERE phone_e164 = NEW.phone) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS marketing_sales_skip_internal ON marketing_sales;
--> statement-breakpoint
CREATE TRIGGER marketing_sales_skip_internal BEFORE INSERT ON marketing_sales
  FOR EACH ROW EXECUTE FUNCTION skip_internal_phone();
--> statement-breakpoint
DROP TRIGGER IF EXISTS call_list_contacts_skip_internal ON marketing_call_list_contacts;
--> statement-breakpoint
CREATE TRIGGER call_list_contacts_skip_internal BEFORE INSERT ON marketing_call_list_contacts
  FOR EACH ROW EXECUTE FUNCTION skip_internal_phone();
--> statement-breakpoint
-- Cleanup of what is already there. Logged calls stay: they were made.
UPDATE sales SET customer_id = NULL
WHERE customer_id IN (SELECT c.id FROM customers c JOIN internal_accounts i ON i.phone_e164 = c.phone_e164);
--> statement-breakpoint
DELETE FROM marketing_sales WHERE phone IN (SELECT phone_e164 FROM internal_accounts);
--> statement-breakpoint
DELETE FROM marketing_call_list_contacts WHERE phone IN (SELECT phone_e164 FROM internal_accounts);
