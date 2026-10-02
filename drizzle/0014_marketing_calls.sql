CREATE TABLE "marketing_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"lead_name" text NOT NULL,
	"phone" text NOT NULL,
	"salesperson" text NOT NULL,
	"outcome" text,
	"note" text NOT NULL DEFAULT '',
	"called_at" timestamp NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "marketing_calls_salesperson_called_idx" ON "marketing_calls" USING btree ("salesperson","called_at");
--> statement-breakpoint
CREATE INDEX "marketing_calls_called_idx" ON "marketing_calls" USING btree ("called_at");
