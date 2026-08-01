-- Implements the name trust order in D-24.
--
-- Without provenance, "enrich, don't overwrite" degrades to "first writer
-- wins": import sales before leads and every customer keeps the POS cashier's
-- spelling forever. Measured POS names include `MARY JOSEPHINE 321`; the
-- walk-in form is typed by the customer at leisure and is the best name we
-- hold. Storing which source supplied the name lets the upsert compare.
--
--   walk-in form   3   customer typed it themselves
--   Meta lead form 2   customer typed it, on a phone, into an ad unit
--   POS bill       1   cashier typed it mid-transaction
--   unknown        0

ALTER TABLE customers ADD COLUMN IF NOT EXISTS name_source text;

COMMENT ON COLUMN customers.name_source IS
  'Channel that supplied full_name; drives the D-24 trust comparison on upsert.';

CREATE OR REPLACE FUNCTION name_trust_rank(source text)
RETURNS int
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE source
           WHEN 'walkin'   THEN 3
           WHEN 'meta'     THEN 2
           WHEN 'whatsapp' THEN 1  -- carries no names, listed for completeness
           WHEN 'existing' THEN 1  -- POS bills import under this channel
           ELSE 0
         END;
$$;

-- Everything imported so far came from the POS sales report.
UPDATE customers
SET    name_source = 'existing'
WHERE  full_name IS NOT NULL AND name_source IS NULL;
