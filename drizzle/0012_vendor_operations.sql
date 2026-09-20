ALTER TABLE "vendors" ADD COLUMN "vendor_code" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "contact_person" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "pan" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "category_supplied" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_vendor_code_unique" UNIQUE("vendor_code");--> statement-breakpoint

CREATE TABLE "vendor_purchase_orders" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "po_number" text NOT NULL,
  "vendor_id" integer NOT NULL,
  "purchase_date" date NOT NULL,
  "category" text,
  "received_date" date,
  "qc_status" text DEFAULT 'pending' NOT NULL,
  "payment_due_date" date,
  "payment_status" text DEFAULT 'unpaid' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vendor_purchase_orders_po_number_unique" UNIQUE("po_number")
);--> statement-breakpoint
CREATE TABLE "vendor_purchase_items" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "purchase_order_id" bigint NOT NULL,
  "sku_no" text NOT NULL,
  "item_name" text,
  "qty" numeric(12,2) NOT NULL,
  "cost" numeric(12,2) NOT NULL,
  "mrp" numeric(12,2),
  "received_qty" numeric(12,2),
  "qc_status" text DEFAULT 'pending' NOT NULL,
  "return_qty" numeric(12,2) DEFAULT '0' NOT NULL,
  "return_value" numeric(12,2) DEFAULT '0' NOT NULL,
  "store_id" integer,
  "allocated_qty" numeric(12,2) DEFAULT '0' NOT NULL
);--> statement-breakpoint
CREATE TABLE "vendor_payments" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "vendor_id" integer NOT NULL,
  "purchase_order_id" bigint,
  "paid_at" date NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "reference" text
);--> statement-breakpoint
CREATE TABLE "vendor_customer_demands" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "customer_id" bigint,
  "vendor_id" integer,
  "sku_no" text,
  "category" text NOT NULL,
  "requested_qty" numeric(12,2) NOT NULL,
  "fulfilled_qty" numeric(12,2) DEFAULT '0' NOT NULL,
  "expected_revenue" numeric(12,2),
  "status" text DEFAULT 'open' NOT NULL,
  "requested_at" date NOT NULL,
  "notes" text
);--> statement-breakpoint
ALTER TABLE "vendor_purchase_orders" ADD CONSTRAINT "vendor_purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_purchase_items" ADD CONSTRAINT "vendor_purchase_items_purchase_order_id_vendor_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."vendor_purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_purchase_items" ADD CONSTRAINT "vendor_purchase_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_purchase_order_id_vendor_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."vendor_purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_customer_demands" ADD CONSTRAINT "vendor_customer_demands_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_customer_demands" ADD CONSTRAINT "vendor_customer_demands_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_purchase_orders_vendor_idx" ON "vendor_purchase_orders" USING btree ("vendor_id", "purchase_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vendor_purchase_items_po_idx" ON "vendor_purchase_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "vendor_purchase_items_sku_idx" ON "vendor_purchase_items" USING btree ("sku_no");--> statement-breakpoint
CREATE INDEX "vendor_payments_vendor_idx" ON "vendor_payments" USING btree ("vendor_id", "paid_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vendor_customer_demands_vendor_idx" ON "vendor_customer_demands" USING btree ("vendor_id", "requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vendor_customer_demands_customer_idx" ON "vendor_customer_demands" USING btree ("customer_id");
