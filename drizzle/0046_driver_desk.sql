-- Drivers desk: a shared list of drivers that anyone on a calling desk may call (no claiming), with every call kept.
CREATE TABLE IF NOT EXISTS "driver_contacts" (
  "id" bigserial PRIMARY KEY,
  "name" text NOT NULL,
  "phone" text NOT NULL,
  "added_by" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "driver_contacts_phone_uidx" ON "driver_contacts" ("phone");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_calls" (
  "id" bigserial PRIMARY KEY,
  "driver_id" bigint NOT NULL REFERENCES "driver_contacts" ("id") ON DELETE CASCADE,
  "caller" text NOT NULL,
  "outcome" text NOT NULL,
  "note" text NOT NULL DEFAULT '',
  "called_at" timestamp NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_calls_driver_idx" ON "driver_calls" ("driver_id", "called_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_calls_caller_idx" ON "driver_calls" ("caller", "called_at");
