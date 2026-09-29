CREATE TABLE "integration_inbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "integration_inbox_source_entity_idx" ON "integration_inbox" USING btree ("source","entity_id");
--> statement-breakpoint
CREATE TABLE "store_visits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_system" text DEFAULT 'walktrack' NOT NULL,
	"external_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"customer_id" bigint,
	"external_customer_ref" text,
	"visited_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"staff_converted" boolean DEFAULT false NOT NULL,
	"pos_sale_id" bigint,
	"source" text,
	"shopping_intent" text,
	"people" integer DEFAULT 1 NOT NULL,
	"driver_code" text,
	"raw" jsonb NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_visits_source_external_uidx" UNIQUE("source_system","external_id")
);
--> statement-breakpoint
ALTER TABLE "store_visits" ADD CONSTRAINT "store_visits_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");
--> statement-breakpoint
ALTER TABLE "store_visits" ADD CONSTRAINT "store_visits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");
--> statement-breakpoint
ALTER TABLE "store_visits" ADD CONSTRAINT "store_visits_pos_sale_id_sales_id_fk" FOREIGN KEY ("pos_sale_id") REFERENCES "public"."sales"("id");
--> statement-breakpoint
CREATE INDEX "store_visits_customer_idx" ON "store_visits" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "store_visits_store_visited_idx" ON "store_visits" USING btree ("store_id","visited_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "store_visits_pos_sale_uidx" ON "store_visits" USING btree ("pos_sale_id") WHERE "pos_sale_id" IS NOT NULL;
