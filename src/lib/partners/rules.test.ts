/**
 * Partner referral rules (drizzle/0039): who can be referred, how bills are matched inside the purchase window, and
 * how referral statuses follow. Runs against the database in .env.local (skipped without one, or before 0039), inside
 * a transaction that is rolled back.
 */

import { describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { Client } from 'pg';

const url = process.env.DATABASE_URL || config({ path: '.env.local' }).parsed?.DATABASE_URL;

describe.skipIf(!url)('partner referral rules', () => {
  it('marks recent buyers for verification, blocks open referrals, matches bills by IST date inside the window, and expires', async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await client.query(text, values)).rows as T[];
    const one = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
    try {
      await client.query('BEGIN');
      if (!(await one<{ t: string | null }>(`SELECT to_regclass('partner_referrals') AS t`)).t) return; // not migrated to 0039
      await q(`UPDATE settings SET value = '60' WHERE key = 'partner_purchase_window_days'`);
      await q(`UPDATE settings SET value = '2' WHERE key = 'partner_lookback_years'`);

      const store = (await one<{ id: number }>(`INSERT INTO stores (code, name) VALUES ('MG_ROAD', 'MG Road') ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`)).id;
      const batch = (await one<{ id: string }>(`INSERT INTO import_batches (source_type, source_kind, file_name) VALUES ('other', 'sale', 'partner-rules-test') RETURNING id`)).id;
      const today = (await one<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d`)).d;
      const n = Date.now() % 100000;
      const phone = (i: number) => `+9196${String(n).padStart(5, '0')}${String(i).padStart(3, '0')}`;
      const partner = async (i: number) => (await one<{ id: number }>(
        `INSERT INTO partners (partner_code, full_name, contact, phone_e164, email, category, city, consent_at, status, dashboard_token)
         VALUES ($1, 'Test partner', $2, $2, 't@example.com', 'Stylist', 'Bengaluru', now(), 'approved', $3) RETURNING id`,
        [`DPR-9${String(n).padStart(5, '0')}${i}`, phone(900 + i), `test-token-${n}-${i}-abcdefghijklmnop`])).id;
      const customer = async (p: string) => (await one<{ id: number }>(
        `INSERT INTO customers (phone_e164, phone_national, full_name, first_seen_at, last_seen_at) VALUES ($1, right($1, 10), 'Test', now(), now()) RETURNING id`, [p])).id;
      /** A bill on a customer, dated `days` from today (IST), at noon IST, as imported bills often are. */
      const bill = async (customerId: number, days: number, amount = 10000) => (await one<{ voucher_no: string }>(
        `INSERT INTO sales (voucher_no, batch_id, store_id, billed_at, customer_id, bill_amount, raw)
         VALUES ('PTEST-' || $1::text || '-' || floor(random() * 1e9)::text, $2, $3, (((now() AT TIME ZONE 'Asia/Kolkata')::date + $4::int) + time '12:00') AT TIME ZONE 'Asia/Kolkata', $1::bigint, $5, '{}')
         RETURNING voucher_no`, [customerId, batch, store, days, amount])).voucher_no;
      const block = async (p: string, partnerId: number) => (await one<{ b: string | null }>(`SELECT partner_referral_block($1, $2) AS b`, [p, partnerId])).b;
      // Since the program rules (drizzle/0047) an existing customer can be referred; staff verify the partner's part.
      const existing = async (p: string) => (await one<{ e: boolean }>(`SELECT partner_is_existing_customer($1) AS e`, [p])).e;
      /** A referral registered `daysAgo` days ago with the 60-day window. */
      const refer = async (p: string, partnerId: number, daysAgo: number) => (await one<{ id: number }>(
        `INSERT INTO partner_referrals (partner_id, full_name, contact, phone_e164, occasion, consent_at, status, registered_at, registered_on, window_ends_on)
         VALUES ($1, 'Referred', $2, $2, 'Wedding', now(), 'registered', now() - make_interval(days => $3::int),
                 (now() AT TIME ZONE 'Asia/Kolkata')::date - $3::int, (now() AT TIME ZONE 'Asia/Kolkata')::date - $3::int + 60) RETURNING id`,
        [partnerId, p, daysAgo])).id;
      const status = async (id: number) => (await one<{ status: string }>(`SELECT status FROM partner_referrals WHERE id = $1`, [id])).status;
      const commissions = async (id: number) => q<{ voucher_no: string; status: string; bill_amount: string }>(
        `SELECT voucher_no, status, bill_amount FROM partner_commissions WHERE referral_id = $1 ORDER BY billed_at`, [id]);

      const a = await partner(1), b = await partner(2);

      // ── Who can be referred ────────────────────────────────────────────────
      expect(await block(phone(1), a)).toBeNull(); // unknown number
      expect(await block(phone(901), a)).toBe('own_number');
      expect(await block(phone(901), b)).toBeNull(); // another partner's number is fine
      await q(`INSERT INTO internal_accounts (phone_e164, label) VALUES ($1, 'test')`, [phone(2)]);
      expect(await block(phone(2), a)).toBe('internal_number');

      const lead = await customer(phone(3)); // a lead: in the CRM, never bought
      expect(await block(phone(3), a)).toBeNull();
      await bill(lead, -400); // bought 13 months ago
      expect(await block(phone(3), a)).toBeNull();
      expect(await existing(phone(3))).toBe(true);
      const lapsed = await customer(phone(4));
      await bill(lapsed, -800); // bought over two years ago
      expect(await existing(phone(4))).toBe(false);
      await q(`INSERT INTO loyalty_customers (customer_id, batch_id, last_bill_date, raw) VALUES ($1, $2, (now() AT TIME ZONE 'Asia/Kolkata')::date - 100, '{}')`, [lapsed, batch]);
      expect(await existing(phone(4))).toBe(true); // the loyalty list knows a newer bill

      const first = await refer(phone(5), a, 0);
      expect(await block(phone(5), b)).toBe('already_referred');
      await q('SAVEPOINT second_open_referral');
      await expect(refer(phone(5), b, 0)).rejects.toThrow(/partner_referrals_open_phone_uidx/);
      await q('ROLLBACK TO SAVEPOINT second_open_referral');

      // ── Matching bills ─────────────────────────────────────────────────────
      const buyer = await customer(phone(5));
      await bill(buyer, -1); // before registering: never counts
      const inWindow = await bill(buyer, 0, 25000); // same day, noon IST, even if registered later in the day
      await q(`SELECT partner_refresh_referrals()`);
      expect(await status(first)).toBe('converted');
      expect((await commissions(first)).map((c) => [c.voucher_no, c.status, Number(c.bill_amount)])).toEqual([[inWindow, 'pending', 25000]]);
      expect((await one<{ customer_id: number }>(`SELECT customer_id FROM partner_referrals WHERE id = $1`, [first])).customer_id).toBe(buyer);

      await q(`SELECT partner_refresh_referrals()`); // idempotent
      expect(await commissions(first)).toHaveLength(1);

      await q(`UPDATE sales SET bill_amount = 24000 WHERE voucher_no = $1`, [inWindow]); // a pending commission follows its bill
      await q(`SELECT partner_refresh_referrals()`);
      expect(Number((await commissions(first))[0].bill_amount)).toBe(24000);

      await q(`DELETE FROM sales WHERE voucher_no = $1`, [inWindow]); // the bill left the sync
      await q(`SELECT partner_refresh_referrals()`);
      expect(await commissions(first)).toHaveLength(0);
      expect(await status(first)).toBe('registered');

      // A bill on day 60 counts; day 61 does not.
      const old = await refer(phone(6), a, 60);
      const late = await customer(phone(6));
      const lastDay = await bill(late, 0);
      await q(`SELECT partner_refresh_referrals()`);
      expect((await commissions(old)).map((c) => c.voucher_no)).toEqual([lastDay]);
      const older = await refer(phone(7), b, 61);
      await bill(await customer(phone(7)), 0);
      await q(`SELECT partner_refresh_referrals()`);
      expect(await commissions(older)).toHaveLength(0);
      expect(await status(older)).toBe('expired');

      // A validated commission is kept even when it no longer matches; a rejected one does not convert.
      const kept = await refer(phone(8), a, 5);
      const keptBill = await bill(await customer(phone(8)), 0);
      await q(`SELECT partner_refresh_referrals()`);
      await q(`UPDATE partner_commissions SET status = 'validated', commission_amount = 100, payout_month = $1 WHERE voucher_no = $2`, [today.slice(0, 7), keptBill]);
      await q(`DELETE FROM sales WHERE voucher_no = $1`, [keptBill]);
      await q(`SELECT partner_refresh_referrals()`);
      expect((await commissions(kept)).map((c) => c.status)).toEqual(['validated']);
      await q(`UPDATE partner_commissions SET status = 'rejected', commission_amount = NULL, payout_month = NULL WHERE voucher_no = $1`, [keptBill]);
      await q(`SELECT partner_refresh_referrals()`);
      expect(await status(kept)).toBe('registered');

      // An expired referral no longer blocks the number for another partner.
      expect(await existing(phone(7))).toBe(true); // phone 7 bought today, so it is now a customer
      const quiet = await refer(phone(9), a, 70);
      await q(`SELECT partner_refresh_referrals()`);
      expect(await status(quiet)).toBe('expired');
      expect(await block(phone(9), b)).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  }, 60_000);
});
