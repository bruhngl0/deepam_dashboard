CREATE TABLE "marketing_call_list_contacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"list_key" text NOT NULL,
	"list_name" text NOT NULL,
	"source_customer_id" text,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"branch" text NOT NULL DEFAULT '',
	"city" text NOT NULL DEFAULT '',
	"assigned_to" text,
	"assigned_at" timestamp,
	"source_file" text NOT NULL,
	"source_row" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_call_list_contacts_list_phone_uidx" ON "marketing_call_list_contacts" USING btree ("list_key","phone");
--> statement-breakpoint
CREATE INDEX "marketing_call_list_contacts_list_assignment_idx" ON "marketing_call_list_contacts" USING btree ("list_key","assigned_to");
--> statement-breakpoint
CREATE INDEX "marketing_call_list_contacts_phone_idx" ON "marketing_call_list_contacts" USING btree ("phone");
