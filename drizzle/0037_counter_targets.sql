-- HR Intelligence → Counter targets: each month's piece targets for groups of counters at MG Road and Jayanagar.
-- A counter is the ERP's Item Short Name (sale line raw->>'category_id': 03 Mysore Silk, 15 Art Printed…).
-- `codes` is the rule as written on the circular: counter codes, each list optionally limited to pieces whose tag
-- price (Sales Rate) is below or at/above an amount, lists joined with "+": '16, 17, 14, 15 below 5000 + 03'.
-- `assistants`: the sales assistants on the group, as Employee IDs or names, comma separated.
CREATE TABLE IF NOT EXISTS counter_targets (
  id serial PRIMARY KEY,
  store_code text NOT NULL,
  month text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  position integer NOT NULL DEFAULT 0,
  codes text NOT NULL,
  assistants text,
  target_1 integer NOT NULL CHECK (target_1 >= 0),
  target_2 integer CHECK (target_2 >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS counter_targets_month_idx ON counter_targets (month, store_code, position);

-- November 2026, from the two circulars.
INSERT INTO counter_targets (store_code, month, position, codes, assistants, target_1, target_2)
SELECT * FROM (VALUES
  ('JAYANAGAR', '2026-11', 1, '16, 17, 14, 15 below 5000 + 03', 'SHWETHA, SELVAN', 275, 325),
  ('JAYANAGAR', '2026-11', 2, '40, 18, 13, 34, 52 + 16, 17, 14, 15 above 5000', 'RAVIKUMAR, JYOTHI S', 350, 400),
  ('JAYANAGAR', '2026-11', 3, '07, 08, 09, 23', 'KAVYA S, VIJAYKUMAR, THANIGAIVELU', 150, 200),
  ('MG_ROAD', '2026-11', 1, '03, 13', 'AHMED SAUD, ASMA', 150, 200),
  ('MG_ROAD', '2026-11', 2, '34, 52, 37', 'ANNAPURNA, RAJKUMAR', 450, 500),
  ('MG_ROAD', '2026-11', 3, '07, 08, 23 below 30000', 'PAVITHRA, YUVARAJ', 375, 425),
  ('MG_ROAD', '2026-11', 4, '07, 08, 23 above 30000', 'VINAYAKA SAVANUR, BABU', 200, 250),
  ('MG_ROAD', '2026-11', 5, '14, 15, 16, 17 below 5000', 'MANJESH', 725, 775),
  ('MG_ROAD', '2026-11', 6, '14, 15, 16, 17 above 5000', 'BIRENDER, MD SHAHZAD', 350, 400)
) AS v(store_code, month, position, codes, assistants, target_1, target_2)
WHERE NOT EXISTS (SELECT 1 FROM counter_targets WHERE month = '2026-11');
