-- The employee's ID on the biometric attendance device (HRMS "Biometric Id"), so punches can be matched to them.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS biometric_id text;
CREATE UNIQUE INDEX IF NOT EXISTS employees_biometric_id_idx ON employees (biometric_id) WHERE biometric_id IS NOT NULL;
