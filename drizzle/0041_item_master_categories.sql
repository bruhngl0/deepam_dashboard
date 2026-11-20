-- Category IDs follow the ERP's Item Master (Item Master.xlsx, 39 items): each category's ID is CAT- plus
-- its Short Name (ART - POLYSTERS, short name 14, is CAT-14), replacing the CAT-0001 sequence numbers.
--  * the Item Master items take their CAT-<short name>; items CRM did not have yet are added
--  * names that are really an item under another name become aliases of it and are removed as categories:
--    the short names Hemparshwa sent as names ("14", "03", "010"...) and old names (BANARAS SILK SAREE -> BANARASI)
--  * Hemparshwa's product groups (SAREES, FABRICS, SUITS & SETS...) are not categories and are removed
-- Names first seen later (purchase orders, demands, the stock ledger) still get a 4-digit CAT-0110 from the sequence.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS short_name text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS categories_short_name_uidx ON categories (short_name);
--> statement-breakpoint
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_category_code_format;
--> statement-breakpoint
ALTER TABLE categories ADD CONSTRAINT categories_category_code_format CHECK (category_code ~ '^CAT-([0-9]{2,3}|[0-9]{4})$');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS category_aliases (
  alias text PRIMARY KEY CHECK (alias = lower(trim(alias))),
  category_id integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);
--> statement-breakpoint
DROP TABLE IF EXISTS pg_temp.item_master;
--> statement-breakpoint
CREATE TEMP TABLE item_master (name text NOT NULL, short_name text NOT NULL);
--> statement-breakpoint
INSERT INTO item_master (name, short_name) VALUES
  ('ART - POLYSTERS', '14'),
  ('ART - PRINTED', '15'),
  ('BANARASI GEORGETTE', '13'),
  ('BANARASI', '10'),
  ('COTTON SAREES - HANDLOOM', '17'),
  ('COTTON SAREES - PRINTED', '16'),
  ('DESIGNER SAREES - ART EMBROIDERY', '21'),
  ('DESIGNER SAREES - BANDHANI', '04'),
  ('DESIGNER SAREES - PURE EMBROIDERY', '11'),
  ('DUPATTAS', '43'),
  ('FABRICS - BANARASI', '48'),
  ('FABRICS - EMBROIDERED', '46'),
  ('FABRICS - GEORGETTE, CHIFFON & CREPE (ART)', '47'),
  ('FABRICS - SILKS', '45'),
  ('HANDLOOM - GADWAL', '05'),
  ('HANDLOOM - PAITANI', '06'),
  ('KANJIVARAM SILK', '08'),
  ('KIDS - BOYS', '60'),
  ('KIDS - GIRLS', '62'),
  ('LEHENGAS - UNSTITCHED', '19'),
  ('MEN''S WEAR - BOTTOMS', '42'),
  ('MEN''S WEAR - DHOTI', '31'),
  ('MEN''S WEAR - ETHNIC', '35'),
  ('MEN''S WEAR - READYMADE SHIRTS', '41'),
  ('MYSORE SILK', '03'),
  ('PRINTED SAREE', '01'),
  ('READY TO WEAR - KURTIS', '52'),
  ('READY TO WEAR - SALWAR SET', '34'),
  ('READYMADE - BLOUSES', '49'),
  ('READYMADE - LEHENGAS', '37'),
  ('SHAWLS', '44'),
  ('SILK SAREES - ARN/KCH/DWR', '23'),
  ('SILK SAREES - CBE', '07'),
  ('SPECIALTY WEAVES - KOTA SILK', '02'),
  ('SPECIALTY WEAVES - PATOLA', '09'),
  ('STOLE & SCARF', '39'),
  ('TUSSAR AND DUPION', '12'),
  ('UNSTITCHED SUITS - PURE', '18'),
  ('UNSTITCHED SUITS', '40');
--> statement-breakpoint
-- Item Master items: existing rows take their new ID, missing ones are added with it (the trigger only numbers rows without one).
UPDATE categories c SET category_code = 'CAT-' || m.short_name, short_name = m.short_name, name = m.name
  FROM item_master m WHERE lower(trim(c.name)) = lower(m.name);
--> statement-breakpoint
INSERT INTO categories (name, category_code, short_name)
  SELECT m.name, 'CAT-' || m.short_name, m.short_name FROM item_master m
  WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE lower(trim(c.name)) = lower(m.name));
--> statement-breakpoint
-- Short names used as names ("14", "010") point at the item with that short name.
INSERT INTO category_aliases (alias, category_id)
  SELECT lower(trim(c.name)), i.id FROM categories c JOIN categories i ON i.short_name IS NOT NULL AND ltrim(i.short_name, '0') = ltrim(trim(c.name), '0')
  WHERE c.short_name IS NULL AND trim(c.name) ~ '^[0-9]+$'
  ON CONFLICT (alias) DO UPDATE SET category_id = excluded.category_id;
--> statement-breakpoint
INSERT INTO category_aliases (alias, category_id)
  SELECT 'banaras silk saree', id FROM categories WHERE short_name = '10'
  ON CONFLICT (alias) DO UPDATE SET category_id = excluded.category_id;
--> statement-breakpoint
-- Every category that is not an Item Master item goes: the aliased names and Hemparshwa's product groups.
DELETE FROM categories WHERE short_name IS NULL AND category_code < 'CAT-0110' AND (
  lower(trim(name)) IN (SELECT alias FROM category_aliases)
  OR upper(trim(name)) IN ('SAREES', 'FABRICS', 'SUITS & SETS', 'LEHENGAS', 'MEN''S WEAR', 'SHAWLS & STOLES', 'KIDS-GIRLS', 'KIDS-BOYS', 'READYMADE BLOUSES'));
--> statement-breakpoint
DROP TABLE pg_temp.item_master;
--> statement-breakpoint
-- A name that is an alias is not registered again as a category of its own.
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
    AND NOT EXISTS (SELECT 1 FROM category_aliases a WHERE a.alias = lower(trim(part)))
  ON CONFLICT (lower(name)) DO NOTHING;
  RETURN NULL;
END $$;
