-- Ananta Partners (owner, 28 Nov 2026):
-- 1. Partner IDs read APR-00001 (Ananta Partner), not DPR-00001. Existing IDs keep their number; old DPR- links still
--    open (the app maps DPR- to APR-).
-- 2. A customer on a referral link picks the brand, Deepam or Kalaniketan, and a store of that brand. Kalaniketan's
--    stores (Juhu, Mumbai; Ghod Dod Road, Surat) are not CRM stores, so the store is kept by name for them.
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_partner_code_check;
--> statement-breakpoint
UPDATE partners SET partner_code = 'APR-' || substr(partner_code, 5), updated_at = now() WHERE partner_code LIKE 'DPR-%';
--> statement-breakpoint
ALTER TABLE partners ADD CONSTRAINT partners_partner_code_check CHECK (partner_code ~ '^APR-\d{5,}$');
--> statement-breakpoint
ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT 'deepam' CHECK (brand IN ('deepam', 'kalaniketan'));
--> statement-breakpoint
ALTER TABLE partner_referrals ADD COLUMN IF NOT EXISTS preferred_store_label text;
