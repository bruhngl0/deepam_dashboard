CREATE TABLE "exhibition_rsvps" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"contact" text NOT NULL,
	"phone" text,
	"visit_date" date,
	"visit_time" text,
	"party_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "exhibition_rsvps_visit_idx" ON "exhibition_rsvps" USING btree ("visit_date","visit_time");
