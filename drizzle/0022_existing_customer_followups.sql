ALTER TABLE "marketing_call_list_contacts" ADD COLUMN "preferred_store" text;
--> statement-breakpoint
ALTER TABLE "marketing_call_list_contacts" ADD COLUMN "product" text;
--> statement-breakpoint
ALTER TABLE "marketing_call_list_contacts" ADD COLUMN "category" text;
--> statement-breakpoint
ALTER TABLE "marketing_call_list_contacts" ADD COLUMN "followup_due" timestamp;
--> statement-breakpoint
ALTER TABLE "marketing_call_list_contacts" ADD COLUMN "followup_note" text;
--> statement-breakpoint
ALTER TABLE "marketing_call_list_contacts" ADD COLUMN "followup_completed_at" timestamp;
--> statement-breakpoint
CREATE INDEX "marketing_call_list_contacts_followup_idx" ON "marketing_call_list_contacts" USING btree ("assigned_to","followup_due");
