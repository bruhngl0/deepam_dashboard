CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('meta', 'whatsapp', 'walkin', 'google', 'referral', 'existing', 'other');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('pending', 'parsing', 'preview', 'committed', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_basis" AS ENUM('prior_purchase', 'self_declared', 'lead_matched', 'no_lead_match');--> statement-breakpoint
CREATE TYPE "public"."lifecycle" AS ENUM('new', 'existing', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."remark_status" AS ENUM('coming', 'not_connected', 'not_available', 'busy', 'not_interested', 'wrong_number', 'other', 'pending');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('lead', 'sale');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"channel" "channel" NOT NULL,
	"platform" text,
	"started_on" date NOT NULL,
	"ended_on" date,
	"spend_amount" numeric(12, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"phone_e164" text NOT NULL,
	"phone_national" text NOT NULL,
	"is_foreign" boolean DEFAULT false NOT NULL,
	"full_name" text,
	"email" text,
	"area" text,
	"city" text,
	"date_of_birth" date,
	"anniversary" date,
	"preferred_store_id" integer,
	"lifecycle" "lifecycle" DEFAULT 'unknown' NOT NULL,
	"lifecycle_basis" "lifecycle_basis",
	"lifecycle_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" integer,
	"source_type" "channel" NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"file_name" text NOT NULL,
	"sheet_name" text,
	"file_url" text,
	"file_hash" text,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_ok" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"rows_duplicate" integer DEFAULT 0 NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows_rejected" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"error_code" text NOT NULL,
	"error_msg" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_followups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"lead_touch_id" bigint NOT NULL,
	"call1_made" boolean,
	"call2_note" text,
	"final_remark_raw" text,
	"final_remark" "remark_status" DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_followups_lead_touch_id_unique" UNIQUE("lead_touch_id")
);
--> statement-breakpoint
CREATE TABLE "lead_touches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"campaign_id" integer NOT NULL,
	"batch_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"touched_at" timestamp with time zone NOT NULL,
	"touched_at_is_estimated" boolean DEFAULT false NOT NULL,
	"store_pref_id" integer,
	"visit_date_raw" text,
	"visit_slot_raw" text,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"voucher_no" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"store_id" integer NOT NULL,
	"billed_at" timestamp with time zone NOT NULL,
	"customer_id" bigint,
	"customer_name_raw" text,
	"phone_raw" text,
	"qty" integer,
	"bill_amount" numeric(12, 2) NOT NULL,
	"taxable_amount" numeric(12, 2),
	"item_disc_amount" numeric(12, 2),
	"salesman_code" text,
	"helper_name" text,
	"payments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"remarks" text,
	"raw" jsonb NOT NULL,
	CONSTRAINT "sales_voucher_no_unique" UNIQUE("voucher_no")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"voucher_prefix" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_code_unique" UNIQUE("code"),
	CONSTRAINT "stores_voucher_prefix_unique" UNIQUE("voucher_prefix")
);
--> statement-breakpoint
CREATE TABLE "walkin_submissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"submission_id" uuid NOT NULL,
	"customer_id" bigint NOT NULL,
	"batch_id" uuid NOT NULL,
	"store_id" integer,
	"how_did_you_hear" text,
	"purpose_of_visit" text,
	"area" text,
	"city" text,
	"date_of_birth" date,
	"anniversary" date,
	"submitted_at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "walkin_submissions_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_preferred_store_id_stores_id_fk" FOREIGN KEY ("preferred_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows_rejected" ADD CONSTRAINT "import_rows_rejected_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_lead_touch_id_lead_touches_id_fk" FOREIGN KEY ("lead_touch_id") REFERENCES "public"."lead_touches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touches" ADD CONSTRAINT "lead_touches_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touches" ADD CONSTRAINT "lead_touches_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touches" ADD CONSTRAINT "lead_touches_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touches" ADD CONSTRAINT "lead_touches_store_pref_id_stores_id_fk" FOREIGN KEY ("store_pref_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walkin_submissions" ADD CONSTRAINT "walkin_submissions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walkin_submissions" ADD CONSTRAINT "walkin_submissions_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walkin_submissions" ADD CONSTRAINT "walkin_submissions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_name_started_idx" ON "campaigns" USING btree ("name","started_on");--> statement-breakpoint
CREATE INDEX "customers_phone_national_idx" ON "customers" USING btree ("phone_national" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_email_trgm_idx" ON "customers" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_lifecycle_idx" ON "customers" USING btree ("lifecycle");--> statement-breakpoint
CREATE INDEX "import_rejects_unresolved_idx" ON "import_rows_rejected" USING btree ("batch_id") WHERE resolved = false;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_touches_identity_idx" ON "lead_touches" USING btree ("customer_id","campaign_id","channel");--> statement-breakpoint
CREATE INDEX "lead_touches_customer_idx" ON "lead_touches" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "lead_touches_campaign_channel_idx" ON "lead_touches" USING btree ("campaign_id","channel");--> statement-breakpoint
CREATE INDEX "lead_touches_touched_at_idx" ON "lead_touches" USING btree ("touched_at");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id") WHERE customer_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_store_billed_idx" ON "sales" USING btree ("store_id","billed_at");--> statement-breakpoint
CREATE INDEX "sales_billed_at_idx" ON "sales" USING btree ("billed_at");--> statement-breakpoint
CREATE INDEX "walkin_customer_idx" ON "walkin_submissions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "walkin_store_submitted_idx" ON "walkin_submissions" USING btree ("store_id","submitted_at");