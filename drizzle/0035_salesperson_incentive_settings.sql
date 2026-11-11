-- Per-salesperson incentive settings (Salespeople → Incentives). weekend_staff: paid on the weekend-staff rule of
-- the incentive circulars (₹5,000 at ₹5 L MG Road / ₹3.5 L Jayanagar) instead of the volume bands. Keyed by the
-- analytics Salesperson ID (EMP-0001); a salesperson with no row is regular staff.
CREATE TABLE IF NOT EXISTS salesperson_incentive_settings (
  emp_code text PRIMARY KEY CHECK (emp_code ~ '^EMP-[0-9]{4}$'),
  weekend_staff boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
