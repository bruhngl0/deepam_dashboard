-- Outreach log — the CRM's first write path.
--
-- Every table before this one records something that happened *to* the
-- business: a lead arrived, a bill was rung up, a loyalty export landed. This
-- one records something the business *did* — someone was called, and this is
-- what came of it. Without it the worklists are just another read-only
-- ranking, and nobody can tell a customer who was contacted and said no from
-- one nobody has phoned yet.
--
-- ── Why not extend `lead_followups` ─────────────────────────────────────────
-- That table hangs off `lead_touch_id`, so it can only ever describe someone
-- who appeared on a lead sheet. The single largest outreach population here is
-- the opposite: 67,400 dormant customers with real purchase history and no
-- lead touch at all, who are structurally unreachable from that key. Keyed to
-- `customer_id` instead, which every one of them has (D-03: phone is the only
-- identity in this system).
--
-- ── Append-only, like `lead_touches` (D-40) ─────────────────────────────────
-- One row per contact attempt, never updated in place, and no
-- `last_contacted` column on `customers`. Calling someone three times across
-- two months is three facts, and a status column would keep only the last one
-- while quietly making "how many times did we chase this person" unanswerable.
-- Suppression windows are derived from this log, not stored as a flag.
--
-- ── `outcome` reuses `remark_status` ────────────────────────────────────────
-- The tele-calling outcome vocabulary already exists (D-67) and already means
-- exactly this: connected/not-connected/not-interested/wrong-number. A second
-- near-identical enum would guarantee the two drift. `pending` is the default
-- for a row created when the task is claimed but the call hasn't happened yet.
--
-- ── `score_at_contact` ──────────────────────────────────────────────────────
-- The score the row carried when it was surfaced, frozen at contact time. The
-- scoring weights in `lib/queries/worklist.ts` are a starting hypothesis, not
-- a measured model; storing the score the caller actually acted on is what
-- makes it possible to check later whether a high score predicted anything.
-- Recomputing it after the fact would measure today's weights against
-- yesterday's outcome and prove nothing.

CREATE TYPE "public"."outreach_list" AS ENUM('reactivation', 'second_visit');--> statement-breakpoint

CREATE TABLE "outreach_contacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"customer_id" bigint NOT NULL,
	"list_kind" "outreach_list" NOT NULL,
	"outcome" "remark_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"contacted_by" text,
	"contacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"score_at_contact" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "outreach_contacts" ADD CONSTRAINT "outreach_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The suppression lookup: "has this person been contacted recently, on any
-- list". Ordered DESC because every read of it wants the most recent row.
CREATE INDEX "outreach_contacts_customer_idx" ON "outreach_contacts" USING btree ("customer_id","contacted_at" DESC);--> statement-breakpoint
CREATE INDEX "outreach_contacts_list_idx" ON "outreach_contacts" USING btree ("list_kind","contacted_at" DESC);--> statement-breakpoint
CREATE INDEX "outreach_contacts_outcome_idx" ON "outreach_contacts" USING btree ("outcome");
