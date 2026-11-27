/**
 * Ananta Partner Network program rules v1.0 (drizzle/0047), checked against the rules document's own examples:
 * level thresholds, whole-month commission and bonus, net value (before GST, less returns), returns before and after
 * payment, existing-customer verification, month-end partnership level reviews (upgrade, two-review downgrade, the
 * approval month and zero months), and rule versions by month. Runs against the database in .env.local (skipped
 * without one, or before 0047), inside a transaction that is rolled back.
 */

import { describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { Client } from 'pg';

const url = process.env.DATABASE_URL || config({ path: '.env.local' }).parsed?.DATABASE_URL;

describe.skipIf(!url)('partner program rules', () => {
  it('works out levels, whole-month commission, returns, verification, reviews and versions as the rules say', async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await client.query(text, values)).rows as T[];
    const one = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];
    try {
      await client.query('BEGIN');
      if (!(await one<{ t: string | null }>(`SELECT to_regclass('partner_months') AS t`)).t) return; // not migrated to 0047

      const thisMonth = (await one<{ m: string }>(`SELECT partner_this_month() AS m`)).m;
      const month = (back: number) => shiftMonth(thisMonth, -back);
      const levelAt = async (value: number, m = thisMonth) =>
        Number((await one<{ l: string }>(`SELECT partner_level_for((partner_rules_for($1)).levels, $2) ->> 'level' AS l`, [m, value])).l);

      // ── Thresholds (§24.1): exactly ₹2L, ₹5L, ₹7L and ₹10L reach the next level ──
      expect([await levelAt(0), await levelAt(199999.99), await levelAt(200000), await levelAt(499999), await levelAt(500000),
        await levelAt(699999.99), await levelAt(700000), await levelAt(999999), await levelAt(1000000), await levelAt(5e7)])
        .toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);

      // ── Fixtures ──
      await q(`DELETE FROM partner_level_reviews`); // reviews run from the oldest unreviewed month; start clean in this transaction
      const stores = await Promise.all(['MG_ROAD', 'JAYANAGAR', 'KALANIKETAN_T'].map(async (code) =>
        (await one<{ id: number }>(`INSERT INTO stores (code, name) VALUES ($1, $1) ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`, [code])).id));
      const batch = (await one<{ id: string }>(`INSERT INTO import_batches (source_type, source_kind, file_name) VALUES ('other', 'sale', 'program-rules-test') RETURNING id`)).id;
      const n = Date.now() % 100000;
      let seq = 0;
      const phone = () => `+9197${String(n).padStart(5, '0')}${String(++seq).padStart(3, '0')}`;
      /** An approved partner, approved on the 10th of `approvedMonth`. */
      const partner = async (approvedMonth: string) => (await one<{ id: number }>(
        `INSERT INTO partners (partner_code, full_name, contact, phone_e164, email, category, city, consent_at, status, dashboard_token, approved_at, level)
         VALUES ($1, 'Test partner', $2, $2, 't@example.com', 'Fashion Stylists', 'Bengaluru', now(), 'approved', $3,
                 (($4 || '-10')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata', 1) RETURNING id`,
        [`DPR-8${String(n).padStart(5, '0')}${++seq}`, phone(), `rules-token-${n}-${seq}-abcdefghijklmnop`, approvedMonth])).id;
      /**
       * A referred customer of `partnerId` who buys on the 15th of `m`: value before GST `net` (the bill carries 5% GST
       * on top), at store `store`. Returns the voucher number.
       */
      const sale = async (partnerId: number, m: string, net: number, store = stores[0], opts: { verify?: 'pending' } = {}) => {
        const p = phone();
        const customer = (await one<{ id: number }>(
          `INSERT INTO customers (phone_e164, phone_national, full_name, first_seen_at, last_seen_at) VALUES ($1, right($1, 10), 'Buyer', now(), now()) RETURNING id`, [p])).id;
        await q(`INSERT INTO partner_referrals (partner_id, full_name, contact, phone_e164, customer_id, occasion, consent_at, status, registered_at, registered_on, window_ends_on, verify_status)
                 VALUES ($1, 'Buyer', $2, $2, $3, 'Wedding', now(), 'registered', now(), ($4 || '-01')::date, ($4 || '-01')::date + 30, $5)`,
          [partnerId, p, customer, m, opts.verify ?? null]);
        return (await one<{ v: string }>(
          `INSERT INTO sales (voucher_no, batch_id, store_id, billed_at, customer_id, bill_amount, taxable_amount, raw)
           VALUES ('RTEST-' || $1::text || '-' || floor(random() * 1e9)::text, $2, $3, (($4 || '-15')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata', $1::bigint, $5, $6, '{}')
           RETURNING voucher_no AS v`, [customer, batch, store, m, Math.round(net * 1.05 * 100) / 100, net])).v;
      };
      const refresh = async () => { await q(`SELECT partner_refresh_referrals()`); await q(`SELECT partner_refresh_months()`); };
      const monthRow = async (partnerId: number, m: string) => one<{ eligible_sales: string; commission_level: number; commission_percent: string; commission: string; bonus: string; by_store: Record<string, string> }>(
        `SELECT * FROM partner_months WHERE partner_id = $1 AND month = $2`, [partnerId, m]);
      const money = (row: { eligible_sales: string; commission_level: number; commission_percent: string; commission: string; bonus: string }) =>
        [Number(row.eligible_sales), row.commission_level, Number(row.commission_percent), Number(row.commission), Number(row.bonus)];

      // ── The rules document's calculation example (§4): ₹4L + ₹1L + ₹3L across stores = ₹8L → Level 4, 12% = ₹96,000 + ₹3,000 ──
      const last = month(1);
      const c = await partner(month(6));
      const mg = await sale(c, last, 400000, stores[0]);
      await sale(c, last, 100000, stores[1]);
      const kala = await sale(c, last, 300000, stores[2]);
      await refresh();
      const m = await monthRow(c, last);
      expect(money(m)).toEqual([800000, 4, 12, 96000, 3000]);
      expect(Object.keys(m.by_store).sort()).toEqual(['JAYANAGAR', 'KALANIKETAN_T', 'MG_ROAD']);
      // Net value is before GST: the ₹4,20,000 bill counts ₹4,00,000.
      expect(Number((await one<{ net_amount: string }>(`SELECT net_amount FROM partner_commissions WHERE voucher_no = $1`, [mg])).net_amount)).toBe(400000);

      // Validated lines take the whole month's rate (12% on every bill, not slab by slab).
      await q(`UPDATE partner_commissions SET status = 'validated', payout_month = partner_month_of(billed_at), commission_amount = 0, commission_percent = 0 WHERE partner_id = $1`, [c]);
      await refresh();
      expect((await q<{ a: string }>(`SELECT commission_amount AS a FROM partner_commissions WHERE partner_id = $1 ORDER BY net_amount DESC`, [c])).map((r) => Number(r.a))).toEqual([48000, 36000, 12000]);

      // ── A return before settlement (§14): half of the ₹3L bill back → ₹6.5L → Level 3, 10% on everything, ₹2,000 bonus ──
      await q(`UPDATE sales SET returned_amount = bill_amount / 2 WHERE voucher_no = $1`, [kala]);
      await refresh();
      expect(money(await monthRow(c, last))).toEqual([650000, 3, 10, 65000, 2000]);
      expect((await q<{ a: string }>(`SELECT commission_amount AS a FROM partner_commissions WHERE partner_id = $1 ORDER BY net_amount DESC`, [c])).map((r) => Number(r.a))).toEqual([40000, 15000, 10000]);
      // Fully returned: nothing from that bill; exactly ₹5L left still reaches Level 3.
      await q(`UPDATE sales SET fully_returned = true WHERE voucher_no = $1`, [kala]);
      await refresh();
      expect(money(await monthRow(c, last))).toEqual([500000, 3, 10, 50000, 2000]);

      // ── Once paid, the month is fixed: a later return does not rewrite it (corrections are separate) ──
      await q(`UPDATE partner_commissions SET status = 'paid', paid_at = now(), payout_reference = 'UTR1' WHERE partner_id = $1 AND status = 'validated'`, [c]);
      await q(`UPDATE partner_months SET paid_at = now(), payout_reference = 'UTR1' WHERE partner_id = $1 AND month = $2`, [c, last]);
      await q(`UPDATE sales SET returned_amount = bill_amount WHERE voucher_no = $1`, [mg]);
      await refresh();
      expect(money(await monthRow(c, last))).toEqual([500000, 3, 10, 50000, 2000]);
      expect(Number((await one<{ a: string }>(`SELECT commission_amount AS a FROM partner_commissions WHERE voucher_no = $1`, [mg])).a)).toBe(40000);

      // ── Existing customers can be referred, but earn only once verified (§10.11) ──
      const v = await partner(month(6));
      const known = phone();
      const knownId = (await one<{ id: number }>(
        `INSERT INTO customers (phone_e164, phone_national, full_name, first_seen_at, last_seen_at) VALUES ($1, right($1, 10), 'Regular', now(), now()) RETURNING id`, [known])).id;
      await q(`INSERT INTO sales (voucher_no, batch_id, store_id, billed_at, customer_id, bill_amount, raw)
               VALUES ('RTEST-OLD-' || floor(random() * 1e9)::text, $1, $2, now() - interval '200 days', $3, 5000, '{}')`, [batch, stores[0], knownId]);
      expect((await one<{ b: string | null }>(`SELECT partner_referral_block($1, $2) AS b`, [known, v])).b).toBeNull();
      expect((await one<{ e: boolean }>(`SELECT partner_is_existing_customer($1) AS e`, [known])).e).toBe(true);
      await sale(v, last, 250000, stores[0], { verify: 'pending' });
      await refresh();
      expect(await monthRow(v, last)).toBeUndefined(); // not counted while unverified
      await q(`UPDATE partner_referrals SET verify_status = 'verified', verified_by = 'Test' WHERE partner_id = $1`, [v]);
      await refresh();
      expect(money(await monthRow(v, last))).toEqual([250000, 2, 10, 25000, 1000]);

      // ── Month-end partnership level reviews (§6) ──
      // The rules' example: approved in month −4 (that partial month never counts), then ₹6L, ₹8L, ₹10L.
      const up = await partner(month(4));
      await sale(up, month(3), 600000);
      await sale(up, month(2), 800000);
      await sale(up, month(1), 1000000);
      // Downgrades only after two reviews in a row below: ₹8L in its first full month, then nothing.
      const down = await partner(month(5));
      await sale(down, month(4), 800000);
      await refresh();
      await q(`UPDATE settings SET value = to_jsonb($1::text) WHERE key = 'partner_reviews_from'`, [month(5)]);
      await q(`SELECT partner_run_reviews()`);
      const reviews = async (id: number) => q<{ review_month: string; months_counted: number; average_sales: string; qualifying_level: number; new_level: number; below_streak: number }>(
        `SELECT * FROM partner_level_reviews WHERE partner_id = $1 AND kind = 'monthly' ORDER BY review_month`, [id]);
      expect((await reviews(up)).map((r) => [r.review_month, r.months_counted, Number(r.average_sales), r.qualifying_level, r.new_level])).toEqual([
        [month(3), 1, 600000, 3, 3], // first full month: upgrade straight away
        [month(2), 2, 700000, 4, 4],
        [month(1), 3, 800000, 4, 4], // three-month average ₹8L: Level 4 privileges this month…
      ]);
      expect(money(await monthRow(up, month(1)))).toEqual([1000000, 5, 15, 150000, 5000]); // …while last month earned at Level 5's 15%
      expect((await one<{ level: number }>(`SELECT level FROM partners WHERE id = $1`, [up])).level).toBe(4);

      expect((await reviews(down)).map((r) => [r.review_month, Number(r.average_sales), r.qualifying_level, r.new_level, r.below_streak])).toEqual([
        [month(4), 800000, 4, 4, 0],
        [month(3), 400000, 2, 4, 1],           // once below: kept
        [month(2), 800000 / 3, 2, 2, 0],       // twice in a row: down to the latest average's level
        [month(1), 0, 1, 2, 1],                // zero months count once past the first full month
      ].map(([a, b, ...rest]) => [a, Math.round(Number(b) * 100) / 100, ...rest]));

      // Idempotent: running again reviews nothing new.
      expect(Number((await one<{ n: number }>(`SELECT partner_run_reviews() AS n`)).n)).toBe(0);

      // ── Rule versions by month (§23): a change from this month leaves last month's rules alone ──
      const before = (await one<{ id: number }>(`SELECT (partner_rules_for($1)).id AS id`, [last])).id;
      const levels = (await one<{ l: unknown }>(`SELECT (partner_rules_for($1)).levels AS l`, [thisMonth])).l as { level: number; commissionPercent: number }[];
      levels[3].commissionPercent = 13;
      const added = (await one<{ id: number }>(
        `INSERT INTO partner_rule_versions (effective_month, levels, terms, reason, changed_by)
         SELECT $1, $2::jsonb, terms, 'test', 'test' FROM partner_rules_for($1) RETURNING id`, [thisMonth, JSON.stringify(levels)])).id;
      expect((await one<{ id: number }>(`SELECT (partner_rules_for($1)).id AS id`, [thisMonth])).id).toBe(added);
      expect((await one<{ id: number }>(`SELECT (partner_rules_for($1)).id AS id`, [last])).id).toBe(before);
      await refresh();
      expect(money(await monthRow(v, last))).toEqual([250000, 2, 10, 25000, 1000]); // last month: unchanged

      // The referral validity in force comes from the rules (30 days by default).
      expect((await one<{ d: number }>(`SELECT partner_setting_int('partner_purchase_window_days', 60) AS d`)).d).toBe(30);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  }, 60_000);
});

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}
