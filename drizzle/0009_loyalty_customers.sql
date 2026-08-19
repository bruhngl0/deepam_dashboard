-- Seed existing customers from a bulk loyalty/CRM export (D-38 extension).
--
-- `recompute_customer_lifecycle()` rebuilds lifecycle from scratch on every
-- import, reading only `sales`, `walkin_submissions` and `lead_touches` — a
-- hand-set `lifecycle = 'existing'` on a freshly-inserted customer would be
-- silently wiped back to `unknown` the moment the next lead or sales batch
-- imports and triggers a recompute. `loyalty_customers` gives that function
-- a fourth evidence source so the classification survives every future
-- recompute instead of a stored flag nobody re-derives.
--
-- Precedence, folded into the existing `prior_purchase`/`self_declared`
-- tiers rather than added as new ones: a loyalty row with real bill history
-- (`total_bill_count > 0`) is exactly as provable as a real `sales` row, so
-- it ranks `prior_purchase`; a loyalty row with no bill evidence is the
-- business's own registry saying "known customer" with nothing to prove it
-- by, the same standing a walk-in's "Existing Customer" checkbox already
-- gets, so it ranks `self_declared`. `lead_matched`/`no_lead_match` and the
-- window-comparison logic in the existing `sales` rule are unchanged.

ALTER TYPE "public"."source_kind" ADD VALUE 'existing_customer';--> statement-breakpoint

CREATE TABLE "loyalty_customers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"batch_id" uuid NOT NULL,
	"external_user_id" text,
	"loyalty_type" text,
	"registered_store_name" text,
	"preferred_store_raw" text,
	"total_bill_count" integer,
	"total_bill_amount" numeric(12, 2),
	"first_bill_date" date,
	"last_bill_date" date,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "loyalty_customers" ADD CONSTRAINT "loyalty_customers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_customers" ADD CONSTRAINT "loyalty_customers_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_customers_customer_idx" ON "loyalty_customers" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "loyalty_customers_bill_count_idx" ON "loyalty_customers" USING btree ("total_bill_count");--> statement-breakpoint

CREATE OR REPLACE FUNCTION recompute_customer_lifecycle()
RETURNS void
LANGUAGE sql
AS $$
  WITH window_start AS (
    SELECT MIN(started_on)::timestamptz AT TIME ZONE 'Asia/Kolkata' AS opens_at
    FROM   campaigns
  ),
  basis AS (
    SELECT
      c.id AS customer_id,
      CASE
        -- Provable: a bill predates the campaign window entirely.
        WHEN EXISTS (
          SELECT 1
          FROM   sales s, window_start w
          WHERE  s.customer_id = c.id
            AND  w.opens_at IS NOT NULL
            AND  s.billed_at < w.opens_at
        ) THEN 'prior_purchase'::lifecycle_basis

        -- Equally provable: the loyalty master export carries real bill
        -- history for this person, just not itemized into `sales` rows.
        WHEN EXISTS (
          SELECT 1 FROM loyalty_customers lc
          WHERE  lc.customer_id = c.id AND COALESCE(lc.total_bill_count, 0) > 0
        ) THEN 'prior_purchase'::lifecycle_basis

        -- The customer told us so on the walk-in form.
        WHEN EXISTS (
          SELECT 1 FROM walkin_submissions ws
          WHERE  ws.customer_id = c.id
            AND  ws.how_did_you_hear = 'Existing Customer'
        ) THEN 'self_declared'::lifecycle_basis

        -- No bill evidence, but the business's own loyalty registry already
        -- knows them — the same standing as the walk-in checkbox above.
        WHEN EXISTS (
          SELECT 1 FROM loyalty_customers lc WHERE lc.customer_id = c.id
        ) THEN 'self_declared'::lifecycle_basis

        -- Appears in a lead source → an acquisition target.
        WHEN EXISTS (
          SELECT 1 FROM lead_touches lt WHERE lt.customer_id = c.id
        ) THEN 'lead_matched'::lifecycle_basis

        -- Bought, but matches no lead record at all. Weakest evidence: this
        -- conflates genuine repeat customers with first-time walk-ins who
        -- never filled a form.
        WHEN EXISTS (
          SELECT 1 FROM sales s WHERE s.customer_id = c.id
        ) THEN 'no_lead_match'::lifecycle_basis

        ELSE NULL
      END AS lifecycle_basis
    FROM customers c
  )
  UPDATE customers c
  SET    lifecycle_basis = b.lifecycle_basis,
         lifecycle = CASE b.lifecycle_basis
                       WHEN 'prior_purchase' THEN 'existing'
                       WHEN 'self_declared'  THEN 'existing'
                       WHEN 'no_lead_match'  THEN 'existing'
                       WHEN 'lead_matched'   THEN 'new'
                       ELSE 'unknown'
                     END::lifecycle,
         lifecycle_at = now(),
         updated_at = now()
  FROM   basis b
  WHERE  b.customer_id = c.id
    AND (c.lifecycle_basis IS DISTINCT FROM b.lifecycle_basis);
$$;--> statement-breakpoint

SELECT recompute_customer_lifecycle();--> statement-breakpoint
REFRESH MATERIALIZED VIEW customer_attribution;
