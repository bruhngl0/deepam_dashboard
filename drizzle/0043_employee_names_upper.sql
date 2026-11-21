-- Employee names in capitals everywhere (the first list mixed "ARYAN CHATURVEDI" with "Vijaya Ananth"), with Keka's
-- trailing " ." (as in "Jayakumar .") and doubled spaces dropped. The employee form saves names the same way from now on.
UPDATE employees
SET full_name = upper(regexp_replace(regexp_replace(btrim(full_name), '\s+\.$', ''), '\s+', ' ', 'g')), updated_at = now()
WHERE full_name IS DISTINCT FROM upper(regexp_replace(regexp_replace(btrim(full_name), '\s+\.$', ''), '\s+', ' ', 'g'));
