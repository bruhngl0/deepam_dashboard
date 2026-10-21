-- A Customer ID (CUS-) belongs to customers only. A person is a customer when they have a bill
-- (sales, or a bill matched in Marketing Intelligence), are on the loyalty list, the ERP customer
-- master (Hemparshwa) or an existing-customer call list, or have a converted WalkTrack walk-in.
-- Everyone else CRM holds is a lead and carries only a Lead ID (LED-): campaign and sheet leads,
-- and walk-ins (and walk-in forms) that did not convert.
--
-- Until now every row in `customers` got a CUS- on insert. From here the code is issued when the
-- person first qualifies, and the codes already on lead-only people are retired: kept in
-- customer_codes_retired so an old link still finds the person, never issued again.

-- The ERP master stores phones as typed; match them on their last ten digits.
CREATE INDEX IF NOT EXISTS hemparshwa_customers_national_idx
  ON hemparshwa_customers ((right(regexp_replace(phone, '\D', '', 'g'), 10))) WHERE phone IS NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION customer_qualifies(cid bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM sales WHERE customer_id = cid)
      OR EXISTS (SELECT 1 FROM loyalty_customers WHERE customer_id = cid)
      OR EXISTS (SELECT 1 FROM store_visits WHERE customer_id = cid AND deleted_at IS NULL AND (staff_converted OR pos_sale_id IS NOT NULL))
      OR EXISTS (SELECT 1 FROM customers c JOIN marketing_call_list_contacts k ON k.phone = c.phone_e164 WHERE c.id = cid)
      OR EXISTS (SELECT 1 FROM customers c JOIN marketing_sales s ON s.phone = c.phone_e164 WHERE c.id = cid)
      OR EXISTS (SELECT 1 FROM customers c JOIN hemparshwa_customers h
                   ON right(regexp_replace(h.phone, '\D', '', 'g'), 10) = c.phone_national AND h.phone IS NOT NULL
                 WHERE c.id = cid)
$$;
--> statement-breakpoint

-- Issues the next CUS- to one person if they qualify and have none yet.
CREATE OR REPLACE FUNCTION assign_customer_code(cid bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cid IS NULL THEN RETURN; END IF;
  UPDATE customers SET customer_code = 'CUS-' || lpad(nextval('customers_customer_code_seq')::text, 6, '0'), updated_at = now()
  WHERE id = cid AND customer_code IS NULL AND customer_qualifies(cid);
END $$;
--> statement-breakpoint

-- Safety net, run by the app every few minutes: everyone who qualifies and has no code gets one.
CREATE OR REPLACE FUNCTION assign_customer_codes() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  WITH due AS (SELECT id FROM customers WHERE customer_code IS NULL AND customer_qualifies(id) ORDER BY id FOR UPDATE)
  UPDATE customers c SET customer_code = 'CUS-' || lpad(nextval('customers_customer_code_seq')::text, 6, '0'), updated_at = now()
  FROM due WHERE c.id = due.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint

-- Trigger bodies: by customer id (NEW.customer_id) or by phone (NEW.phone, E.164).
CREATE OR REPLACE FUNCTION assign_customer_code_by_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assign_customer_code(NEW.customer_id);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assign_customer_code_by_phone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assign_customer_code(id) FROM customers WHERE phone_e164 = NEW.phone;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assign_customer_code_on_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assign_customer_code(NEW.id);
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Every new person used to be numbered on insert; now only one who already qualifies is
-- (e.g. a call-list contact imported before their CRM record).
DROP TRIGGER IF EXISTS customers_assign_code ON customers;
--> statement-breakpoint
CREATE TRIGGER customers_assign_code AFTER INSERT ON customers
  FOR EACH ROW WHEN (NEW.customer_code IS NULL) EXECUTE FUNCTION assign_customer_code_on_insert();
--> statement-breakpoint
CREATE TRIGGER sales_assign_customer_code AFTER INSERT OR UPDATE OF customer_id ON sales
  FOR EACH ROW WHEN (NEW.customer_id IS NOT NULL) EXECUTE FUNCTION assign_customer_code_by_id();
--> statement-breakpoint
CREATE TRIGGER loyalty_assign_customer_code AFTER INSERT OR UPDATE OF customer_id ON loyalty_customers
  FOR EACH ROW EXECUTE FUNCTION assign_customer_code_by_id();
--> statement-breakpoint
-- A walk-in makes a customer only once it is converted (ticked by staff or matched to a bill).
CREATE TRIGGER store_visits_assign_customer_code AFTER INSERT OR UPDATE OF customer_id, staff_converted, pos_sale_id, deleted_at ON store_visits
  FOR EACH ROW WHEN (NEW.customer_id IS NOT NULL AND (NEW.staff_converted OR NEW.pos_sale_id IS NOT NULL) AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION assign_customer_code_by_id();
--> statement-breakpoint
CREATE TRIGGER call_list_assign_customer_code AFTER INSERT OR UPDATE OF phone ON marketing_call_list_contacts
  FOR EACH ROW EXECUTE FUNCTION assign_customer_code_by_phone();
--> statement-breakpoint
CREATE TRIGGER marketing_sales_assign_customer_code AFTER INSERT OR UPDATE OF phone ON marketing_sales
  FOR EACH ROW EXECUTE FUNCTION assign_customer_code_by_phone();
--> statement-breakpoint

-- Codes taken back from lead-only people. A code here is never issued again (the sequence only
-- moves forward); lookups by an old code land on the same person.
CREATE TABLE IF NOT EXISTS customer_codes_retired (
  code text PRIMARY KEY CHECK (code ~ '^CUS-[0-9]{6}$'),
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  retired_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_codes_retired_customer_idx ON customer_codes_retired (customer_id);
--> statement-breakpoint

INSERT INTO customer_codes_retired (code, customer_id)
SELECT customer_code, id FROM customers WHERE customer_code IS NOT NULL AND NOT customer_qualifies(id)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
UPDATE customers SET customer_code = NULL, updated_at = now()
WHERE customer_code IS NOT NULL AND customer_code IN (SELECT code FROM customer_codes_retired);
--> statement-breakpoint

-- Anyone who already qualifies but somehow has no code gets one now.
SELECT assign_customer_codes();
