-- Marketing Intelligence leads and bills move out of each browser's local
-- storage into the shared database, so the Google Sheet sync can write leads
-- and every desk sees the same records.
--
-- `doc` holds the whole lead (acquisitions, interactions, follow-ups) exactly
-- as the client models it. `version` is the optimistic-concurrency token.

CREATE TABLE "marketing_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"phone" text NOT NULL,
	"doc" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_leads_phone_uidx" ON "marketing_leads" USING btree ("phone");
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_leads_seq_uidx" ON "marketing_leads" USING btree ("seq");
--> statement-breakpoint
CREATE TABLE "marketing_sales" (
	"invoice" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"phone" text NOT NULL,
	"amount" numeric(12, 2),
	"sold_at" text DEFAULT '' NOT NULL,
	"store" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_sales_seq_uidx" ON "marketing_sales" USING btree ("seq");
--> statement-breakpoint
CREATE INDEX "marketing_sales_phone_idx" ON "marketing_sales" USING btree ("phone");
