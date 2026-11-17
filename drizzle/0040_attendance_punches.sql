-- Raw punches from the biometric attendance machine (Matrix COSEC, table Mx_ATDEventTrn on the office PC).
-- A small job on that PC (scripts/attendance-agent) posts new punches to /api/integration/attendance/punches;
-- each one is kept here as it came, and attendance_days is worked out from them (lib/hr/attendance-punches.ts).
--
-- device_user_id is the machine's UserID, matched to employees.biometric_id (leading zeros ignored).
-- punched_at is the machine's local time (IST). Posting the same punch again changes nothing.
CREATE TABLE IF NOT EXISTS attendance_punches (
  id bigserial PRIMARY KEY,
  device text NOT NULL DEFAULT 'cosec',
  device_user_id text NOT NULL,
  punched_at timestamptz NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  downloaded_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device, device_user_id, punched_at, direction)
);
CREATE INDEX IF NOT EXISTS attendance_punches_punched_at_idx ON attendance_punches (punched_at);
CREATE INDEX IF NOT EXISTS attendance_punches_user_idx ON attendance_punches (ltrim(device_user_id, '0'));
