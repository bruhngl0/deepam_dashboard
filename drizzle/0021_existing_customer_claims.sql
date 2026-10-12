ALTER TABLE "marketing_call_list_contacts" ADD COLUMN "claimed_at" timestamp;
--> statement-breakpoint
CREATE INDEX "marketing_call_list_contacts_claim_idx" ON "marketing_call_list_contacts" USING btree ("list_key","assigned_to","claimed_at");
