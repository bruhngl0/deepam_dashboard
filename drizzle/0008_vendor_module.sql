ALTER TYPE "public"."channel" ADD VALUE 'vendor';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'vendor_stock';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'sale_items';--> statement-breakpoint
CREATE TABLE "sale_line_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sale_id" bigint,
	"voucher_date_raw" date NOT NULL,
	"voucher_no_raw" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"account_name_raw" text,
	"item_name" text,
	"hsn_code" text,
	"design_no" text,
	"color_name" text,
	"size" text,
	"qty" numeric(12, 2),
	"purc_value" numeric(12, 2),
	"sales_rate" numeric(12, 2),
	"amount" numeric(12, 2),
	"item_disc_amt" numeric(12, 2),
	"item_amt" numeric(12, 2),
	"add_less_amt" numeric(12, 2),
	"net_amt" numeric(12, 2),
	"taxable_amt" numeric(12, 2),
	"sgst_amt" numeric(12, 2),
	"cgst_amt" numeric(12, 2),
	"igst_amt" numeric(12, 2),
	"other_add_less_amt" numeric(12, 2),
	"amt_with_tax" numeric(12, 2),
	"sales_amt" numeric(12, 2),
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_stock_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"batch_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"item_name" text,
	"item_group_name" text,
	"comp_size" text,
	"fresh_or_defective" text,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"op_qty" numeric(12, 2),
	"op_amt" numeric(12, 2),
	"purc_qty" numeric(12, 2),
	"purc_amt" numeric(12, 2),
	"pr_qty" numeric(12, 2),
	"pr_amt" numeric(12, 2),
	"net_purc_qty" numeric(12, 2),
	"net_purc_amt" numeric(12, 2),
	"in_qty" numeric(12, 2),
	"in_amt" numeric(12, 2),
	"out_qty" numeric(12, 2),
	"out_amt" numeric(12, 2),
	"in_transit_qty" numeric(12, 2),
	"in_transit_amt" numeric(12, 2),
	"sales_qty" numeric(12, 2),
	"sales_amt" numeric(12, 2),
	"sr_qty" numeric(12, 2),
	"sr_amt" numeric(12, 2),
	"net_sales_qty" numeric(12, 2),
	"net_sales_amt" numeric(12, 2),
	"cl_qty" numeric(12, 2),
	"cl_amt" numeric(12, 2),
	"cl_mrp" numeric(12, 2),
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "sale_line_items" ADD CONSTRAINT "sale_line_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_items" ADD CONSTRAINT "sale_line_items_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_stock_ledger" ADD CONSTRAINT "vendor_stock_ledger_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_stock_ledger" ADD CONSTRAINT "vendor_stock_ledger_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_line_items_identity_idx" ON "sale_line_items" USING btree ("voucher_date_raw","voucher_no_raw","barcode");--> statement-breakpoint
CREATE INDEX "sale_line_items_sale_idx" ON "sale_line_items" USING btree ("sale_id") WHERE sale_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sale_line_items_barcode_idx" ON "sale_line_items" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_stock_ledger_identity_idx" ON "vendor_stock_ledger" USING btree ("barcode","period_from","period_to");--> statement-breakpoint
CREATE INDEX "vendor_stock_ledger_vendor_idx" ON "vendor_stock_ledger" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vendor_stock_ledger_barcode_idx" ON "vendor_stock_ledger" USING btree ("barcode");