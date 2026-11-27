/**
 * The rules document's 20 mandatory test scenarios (§24), end to end through the real functions: the SQL rules
 * (drizzle/0047, 0048) and the decisions in program.ts (verify, approve, pay, claims, flags, campaigns, collaborations,
 * personal shopping). Scenarios 1, 4 and 9 are covered in detail by program-rules.test.ts; they are checked briefly here.
 *
 * It writes real rows and changes settings, so it runs only against a throwaway database named in
 * PARTNER_SCENARIOS_DB (migrated to 0048), never the one in .env.local:
 *   PARTNER_SCENARIOS_DB=postgresql://…/partner_test npx vitest run src/lib/partners/program-scenarios.test.ts
 */

import { beforeAll, describe, expect, it } from 'vitest';

const url = process.env.PARTNER_SCENARIOS_DB;

describe.skipIf(!url)('partner program: the 20 mandatory scenarios', () => {
  let db: typeof import('@/db').db;
  let sql: typeof import('drizzle-orm').sql;
  let P: typeof import('./program');
  let store: typeof import('./store');
  let rules: typeof import('./rules');

  const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => store.rowsOf<T>(await db.execute(q));
  const one = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await rows<T>(q))[0];
  const n = Date.now() % 100000;
  let seq = 0;
  const phone = () => `+9196${String(n).padStart(5, '0')}${String(++seq).padStart(3, '0')}`;
  let month: (back: number) => string;
  let storeIds: number[];
  let batch: string;

  const partner = async (approvedMonth: string) => (await one<{ id: number }>(sql`
    INSERT INTO partners (partner_code, full_name, contact, phone_e164, email, category, city, consent_at, status, dashboard_token, approved_at, level, documents)
    VALUES (${`DPR-9${String(n).padStart(5, '0')}${++seq}`}, ${`Scenario partner ${seq}`}, ${phone()}, ${phone()}, 's@example.com', 'Fashion Stylists', 'Bengaluru', now(), 'approved',
      ${`scen-token-${n}-${seq}-abcdefghijklmnop`}, ((${approvedMonth} || '-10')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata', 1,
      '{"agreement":"2026-01-01","pan":"2026-01-01","id_proof":"2026-01-01","bank":"2026-01-01"}'::jsonb) RETURNING id`)).id;
  const customer = async (p = phone()) => ({ phone: p, id: (await one<{ id: number }>(sql`
    INSERT INTO customers (phone_e164, phone_national, full_name, first_seen_at, last_seen_at) VALUES (${p}, right(${p}, 10), 'Buyer', now(), now()) RETURNING id`)).id });
  const refer = async (partnerId: number, c: { phone: string; id: number }, m: string, day = '01') => db.execute(sql`
    INSERT INTO partner_referrals (partner_id, full_name, contact, phone_e164, customer_id, occasion, consent_at, status, registered_at, registered_on, window_ends_on)
    VALUES (${partnerId}, 'Buyer', ${c.phone}, ${c.phone}, ${c.id}, 'Wedding', now(), 'registered', ((${m} || '-' || ${day})::date + time '10:00') AT TIME ZONE 'Asia/Kolkata',
      (${m} || '-' || ${day})::date, (${m} || '-' || ${day})::date + 30)`);
  /** A bill of value `net` before GST (5% GST on top) on `day` of month `m`. */
  const bill = async (c: { id: number }, m: string, net: number, storeIdx = 0, day = '15') => (await one<{ v: string }>(sql`
    INSERT INTO sales (voucher_no, batch_id, store_id, billed_at, customer_id, bill_amount, taxable_amount, raw)
    VALUES (${`SCEN-${n}-${++seq}`}, ${batch}, ${storeIds[storeIdx]}, ((${m} || '-' || ${day})::date + time '12:00') AT TIME ZONE 'Asia/Kolkata', ${c.id}, ${Math.round(net * 105) / 100}, ${net}, '{}')
    RETURNING voucher_no AS v`)).v;
  /** A referred customer of `partnerId` registered on the 1st of `m` who buys `net` on the 15th. */
  const sale = async (partnerId: number, m: string, net: number, storeIdx = 0) => {
    const c = await customer();
    await refer(partnerId, c, m);
    return bill(c, m, net, storeIdx);
  };
  const refresh = () => store.refreshReferrals();
  const validateAll = async (partnerId: number) => {
    await refresh(); // new bills matched to their referrals first
    const ids = (await rows<{ id: number }>(sql`SELECT id FROM partner_commissions WHERE partner_id = ${partnerId} AND status = 'pending'`)).map((r) => r.id);
    await store.validateCommissions(ids);
    await refresh();
  };
  const monthRow = (partnerId: number, m: string) => one<Record<string, string>>(sql`SELECT * FROM partner_months WHERE partner_id = ${partnerId} AND month = ${m}`);
  const stmt = async (partnerId: number, m: string) => {
    const r = await one<{ id: number }>(sql`SELECT id FROM partner_settlements WHERE partner_id = ${partnerId} AND month = ${m}`);
    return r ? (await import('./program-queries')).settlement(r.id) : null;
  };
  /** Level `l` of the rules in force in month `m`. */
  const lvl = async (l: number, m: string) => (await rules.rulesFor(m)).levels[l - 1];
  const fails = async (p: Promise<unknown>, message: RegExp) => { await expect(p).rejects.toThrow(message); };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ db } = await import('@/db'));
    ({ sql } = await import('drizzle-orm'));
    P = await import('./program');
    store = await import('./store');
    rules = await import('./rules');
    const thisMonth = rules.thisMonthIst();
    month = (back) => rules.shiftMonth(thisMonth, -back);
    // Statements from six months back so completed months can be settled; defaults for every term.
    await db.execute(sql`INSERT INTO settings (key, value, description) VALUES ('partner_settlements_from', ${JSON.stringify(month(6))}::jsonb, 'test')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    await db.execute(sql`INSERT INTO settings (key, value, description) VALUES ('partner_reviews_from', ${JSON.stringify(month(6))}::jsonb, 'test')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    storeIds = await Promise.all(['MG_ROAD', 'JAYANAGAR', 'KALANIKETAN_T'].map(async (code) =>
      (await one<{ id: number }>(sql`INSERT INTO stores (code, name) VALUES (${code}, ${code}) ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`)).id));
    await P.setEntity('KALANIKETAN_T', 'Kalaniketan');
    batch = (await one<{ id: string }>(sql`INSERT INTO import_batches (source_type, source_kind, file_name) VALUES ('other', 'sale', 'scenarios-test') RETURNING id`)).id;
  });

  it('1, 3: thresholds and a slab upgrade within the month apply to the whole month', async () => {
    const a = await partner(month(8));
    await sale(a, month(5), 199999.99);
    await refresh();
    expect((await monthRow(a, month(5))).commission_level).toBe(1);
    await sale(a, month(5), 0.01); // exactly ₹2L
    await refresh();
    const m = await monthRow(a, month(5));
    expect([Number(m.eligible_sales), m.commission_level, Number(m.commission)]).toEqual([200000, 2, 200000 * (await lvl(2, month(5))).commissionPercent / 100]);
  });

  it('2, 20: sales across stores and entities: commission where sold, bonus by sales, totals reconcile', async () => {
    const a = await partner(month(8));
    await sale(a, month(4), 400000, 0); // MG Road
    await sale(a, month(4), 100000, 1); // Jayanagar
    await sale(a, month(4), 300000, 2); // Kalaniketan
    await validateAll(a);
    const s = (await stmt(a, month(4)))!;
    const l4 = await lvl(4, month(4));
    expect([s.eligibleSales, s.level, s.standard, s.bonus]).toEqual([800000, 4, 800000 * l4.commissionPercent / 100, l4.bonus]);
    expect(s.allocation['Kalaniketan'].commission).toBe(300000 * l4.commissionPercent / 100);
    expect(s.allocation['Deepam by Ananta'].commission).toBe(500000 * l4.commissionPercent / 100);
    expect(s.allocation['Kalaniketan'].bonus).toBe(l4.bonus * 3 / 8); // bonus by each entity's share of sales
    const total = Object.values(s.allocation).reduce((x, e) => x + e.total, 0);
    expect(total).toBeCloseTo(s.gross + s.adjustments, 2);
    const report = await (await import('./program-queries')).entityReport(month(4));
    expect(report.find((r) => r.entity === 'Kalaniketan')!.sales).toBeGreaterThanOrEqual(300000);
  });

  it('5, 6, 14, 16, 13: verify → approve → partial and full payment; no duplicate payments; returns after settlement become adjustments', async () => {
    const a = await partner(month(8));
    const big = await sale(a, month(3), 400000, 0);
    await sale(a, month(3), 150000, 1);
    // Return before settlement: half of the ₹4L bill → ₹3.5L, Level 2.
    await db.execute(sql`UPDATE sales SET returned_amount = bill_amount / 2 WHERE voucher_no = ${big}`);
    await validateAll(a);
    let s = (await stmt(a, month(3)))!;
    const l2 = await lvl(2, month(3)), earned = 350000 * l2.commissionPercent / 100 + l2.bonus;
    expect([s.eligibleSales, s.level, s.standard + s.bonus]).toEqual([350000, 2, earned]);
    expect(s.status).toBe('pending_verification');

    // Verify, then approval by someone else only.
    expect(await P.verifySettlement(s.id, 'Accounts One')).toBe('pending_approval');
    await fails(P.approveSettlement(s.id, 'accounts one'), /cannot also approve/);
    await P.approveSettlement(s.id, 'Manager');
    s = (await stmt(a, month(3)))!;
    expect(s.tds).toBe(Math.round(earned * 0.02 * 100) / 100); // over the ₹20,000 TDS threshold
    const net = s.net;
    expect(net).toBe(earned - s.tds);

    // 14: partial then full; 16: never more than outstanding, never the same reference twice.
    await fails(P.recordPayment(s.id, net + 1, null, 'UTR-A', 'Accounts One'), /more than/);
    expect(await P.recordPayment(s.id, 10000, null, `UTR-${n}-A`, 'Accounts One')).toBe(false);
    expect((await stmt(a, month(3)))!.status).toBe('partially_paid');
    await fails(P.recordPayment(s.id, 100, null, `utr-${n}-a `, 'Accounts One'), /already been recorded/);
    // 13: suspended partners keep earned commission (paid); on hold stops payouts.
    await db.execute(sql`UPDATE partners SET status = 'on_hold' WHERE id = ${a}`);
    await fails(P.recordPayment(s.id, 100, null, `UTR-${n}-H`, 'Accounts One'), /on hold/);
    await db.execute(sql`UPDATE partners SET status = 'suspended' WHERE id = ${a}`);
    expect(await P.recordPayment(s.id, net - 10000, null, `UTR-${n}-B`, 'Accounts One')).toBe(true);
    s = (await stmt(a, month(3)))!;
    expect([s.status, s.paid, s.closing]).toEqual(['paid', net, 0]);
    await fails(P.recordPayment(s.id, 1, null, `UTR-${n}-C`, 'Accounts One'), /already paid/);
    await db.execute(sql`UPDATE partners SET status = 'approved' WHERE id = ${a}`);

    // 5, 6: a return after settlement drops the slab (₹3.5L → ₹1.5L, Level 1): the statement stays, the difference is an adjustment.
    await db.execute(sql`UPDATE sales SET fully_returned = true WHERE voucher_no = ${big}`);
    await refresh();
    s = (await stmt(a, month(3)))!;
    expect([s.status, s.net, s.eligibleSales]).toEqual(['adjusted', net, 350000]);
    const adj = await one<{ amount: string; kind: string }>(sql`SELECT amount, kind FROM partner_adjustments WHERE partner_id = ${a} AND month = ${month(3)}`);
    // Level 1 on ₹1.5L against what was settled at Level 2 on ₹3.5L.
    const lv1 = await lvl(1, month(3));
    expect([adj.kind, Number(adj.amount)]).toEqual(['recalc', 150000 * lv1.commissionPercent / 100 + lv1.bonus - earned]);
    await refresh();
    expect((await rows(sql`SELECT 1 FROM partner_adjustments WHERE partner_id = ${a} AND month = ${month(3)}`)).length).toBe(1); // not twice
    // It lands on the next statement (here last month's, created for it), which goes negative and carries forward (18).
    const next = (await stmt(a, month(1)))!;
    expect(next.adjustments).toBe(Number(adj.amount));
    expect(next.net).toBeLessThan(0);
    expect(await P.verifySettlement(next.id, 'Accounts One')).toBe('verified');
    expect((await stmt(a, month(1)))!.closing).toBe(next.net);
  });

  it('7, 8, 9: duplicate registrations are flagged, expired referrals earn nothing, existing customers wait for verification', async () => {
    const a = await partner(month(8)), b = await partner(month(8));
    // A second partner cannot register a number another partner has open…
    const open = await customer();
    await refer(a, open, rules.thisMonthIst(), '01');
    expect((await one<{ b: string }>(sql`SELECT partner_referral_block(${open.phone}, ${b}) AS b`)).b).toBe('already_referred');
    // …and a number registered again by another partner within 90 days of the first (whose window closed) is flagged.
    const again = await customer();
    await refer(a, again, month(2), '01');
    await refresh();
    await refer(b, again, rules.thisMonthIst(), '01');
    await refresh();
    expect((await rows(sql`SELECT 1 FROM partner_flags WHERE kind = 'duplicate_registration' AND partner_id = ${b}`)).length).toBe(1);
    // 8: bought 40 days after registering (window 30 days).
    const late = await customer();
    await refer(a, late, month(5), '01');
    const v = await bill(late, month(4), 100000, 0, '12');
    await refresh();
    expect((await rows(sql`SELECT 1 FROM partner_commissions WHERE voucher_no = ${v}`)).length).toBe(0);
    // 9: pending verification does not count.
    const known = await customer();
    await db.execute(sql`INSERT INTO partner_referrals (partner_id, full_name, contact, phone_e164, customer_id, occasion, consent_at, status, registered_at, registered_on, window_ends_on, verify_status)
      VALUES (${a}, 'Known', ${known.phone}, ${known.phone}, ${known.id}, 'Wedding', now(), 'registered', now(), ${month(6) + '-01'}::date, ${month(6) + '-01'}::date + 30, 'pending')`);
    await bill(known, month(6), 50000);
    await refresh();
    expect(await monthRow(a, month(6))).toBeUndefined();
  });

  it('10: personal shopping stops at the annual limit; the discount applies only to what is left', async () => {
    const a = await partner(month(8));
    const year = Number(rules.thisMonthIst().slice(0, 4));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await fails(P.recordPersonalPurchase(a, { voucher: `PS-${n}-0`, purchaseOn: today, value: 1000, otp: false, note: null, by: 'Store' }), /OTP/);
    const r1 = await P.recordPersonalPurchase(a, { voucher: `PS-${n}-1`, purchaseOn: today, value: 80000, otp: true, note: null, by: 'Store' });
    const r2 = await P.recordPersonalPurchase(a, { voucher: `PS-${n}-2`, purchaseOn: today, value: 50000, otp: true, note: null, by: 'Store' });
    const lv = (await rules.rulesFor()).levels[0];
    expect([r1.eligible, r2.eligible, r2.left]).toEqual([80000, 20000, 0]);
    expect(r2.discount).toBe(Math.round(20000 * lv.personalDiscount) / 100);
    await fails(P.recordPersonalPurchase(a, { voucher: `PS-${n}-3`, purchaseOn: today, value: 100, otp: true, note: null, by: 'Store' }), /used up/);
    await fails(P.recordPersonalPurchase(a, { voucher: `PS-${n}-1`, purchaseOn: today, value: 100, otp: true, note: null, by: 'Store' }), /already recorded|used up/);
    expect((await P.shoppingAllowance(a, year)).left).toBe(0);
  });

  it('11: a campaign rate replaces the standard rate on its bills; priority decides between two; it can stay out of the slab', async () => {
    const a = await partner(month(8));
    const start = `${month(2)}-01`, end = `${month(2)}-28`;
    const low = await P.createCampaign({ name: 'Festive 15%', startsOn: start, endsOn: end, storeCodes: ['MG_ROAD'], excludedInvoices: [], commissionPercent: 15, priority: 10,
      countsTowardLevel: false, bonusEligible: false, personalDiscountAllowed: false, minMarginPercent: null, notes: null, by: 'Marketing' });
    const other = await P.createCampaign({ name: 'Other 12%', startsOn: start, endsOn: end, storeCodes: [], excludedInvoices: [], commissionPercent: 12, priority: 50,
      countsTowardLevel: true, bonusEligible: true, personalDiscountAllowed: false, minMarginPercent: null, notes: null, by: 'Marketing' });
    await fails(P.setCampaignStatus(low, 'active', 'marketing'), /someone else/);
    await P.setCampaignStatus(low, 'active', 'Manager');
    await P.setCampaignStatus(other, 'active', 'Manager');
    await sale(a, month(2), 300000, 0); // MG Road: Festive 15% (priority 10), outside the slab
    await sale(a, month(2), 100000, 1); // Jayanagar: Other 12%
    await validateAll(a);
    const m = await monthRow(a, month(2));
    expect([Number(m.threshold_sales), m.commission_level, Number(m.campaign_commission), Number(m.standard_commission), Number(m.bonus)])
      .toEqual([100000, 1, 300000 * 0.15 + 100000 * 0.12, 0, (await rules.rulesFor(month(2))).levels[0].bonus]);
    await P.setCampaignStatus(low, 'ended', 'Manager');
    await P.setCampaignStatus(other, 'ended', 'Manager');
  });

  it('12: a bill claimed by two parties is held until decided, then shared within 100%', async () => {
    const a = await partner(month(8));
    const v = await sale(a, month(2), 100000, 1);
    await validateAll(a);
    await P.addClaim(v, 'driver', 'Ravi (driver)', 'Brought the family', 'Store manager');
    await fails(P.addClaim(v, 'travel_agent', 'Agent', null, 'Store manager'), /open claim/);
    await refresh();
    expect((await monthRow(a, month(2))).eligible_sales).toBe('0.00');
    const s = (await stmt(a, month(2)))!;
    await fails(P.verifySettlement(s.id, 'Accounts One'), /on hold/);
    const [claim] = (await (await import('./program-queries')).claims(true)).filter((c) => c.voucher === v);
    await fails(P.resolveClaim(claim.id, 'shared', 100, 'split', 'Manager'), /between 1% and 99%/);
    await P.resolveClaim(claim.id, 'shared', 60, 'Both helped', 'Manager');
    await refresh();
    const m = await monthRow(a, month(2));
    const pct = (await rules.rulesFor(month(2))).levels[0].commissionPercent;
    expect([Number(m.eligible_sales), Number(m.commission)]).toEqual([100000, 100000 * 0.6 * pct / 100]);
    expect(Number((await one<{ a: string }>(sql`SELECT commission_amount AS a FROM partner_commissions WHERE voucher_no = ${v}`)).a)).toBe(100000 * 0.6 * pct / 100);
  });

  it('15: a rule change never reaches back into settled months', async () => {
    const a = await partner(month(8));
    await sale(a, month(2), 250000, 0);
    await validateAll(a);
    const s = (await stmt(a, month(2)))!;
    await P.verifySettlement(s.id, 'Accounts One');
    const before = (await stmt(a, month(2)))!;
    const current = await rules.rulesFor();
    await rules.saveRuleVersion({ levels: current.levels.map((l) => ({ ...l, commissionPercent: l.commissionPercent + 1 })), terms: current.terms,
      effectiveMonth: rules.thisMonthIst(), reason: 'Scenario 15', changedBy: 'Test' });
    await refresh();
    const after = (await stmt(a, month(2)))!;
    expect([after.standard, after.ruleVersionId]).toEqual([before.standard, before.ruleVersionId]);
    expect((await rows(sql`SELECT 1 FROM partner_adjustments WHERE partner_id = ${a}`)).length).toBe(0);
    // Back to the rules as they were (a newer version for the same month replaces it).
    await rules.saveRuleVersion({ levels: current.levels, terms: current.terms, effectiveMonth: rules.thisMonthIst(), reason: 'Scenario 15 restored', changedBy: 'Test' });
  });

  it('16: one invoice earns once: retrospective attribution of an attributed bill is refused; a retrospective bill waits for a second person', async () => {
    const a = await partner(month(8)), b = await partner(month(8));
    const v = await sale(a, month(2), 50000, 0);
    await refresh();
    await fails(P.requestRetro(v, (await one<{ c: string }>(sql`SELECT partner_code AS c FROM partners WHERE id = ${b}`)).c, 'mine', 'Staff'), /already attributed/);
    // A bill before the referral was entered.
    const c = await customer();
    const early = await bill(c, month(2), 80000, 0, '02');
    await refer(b, c, month(2), '10');
    await refresh();
    expect((await rows(sql`SELECT 1 FROM partner_commissions WHERE voucher_no = ${early}`)).length).toBe(0);
    await P.requestRetro(early, (await one<{ c: string }>(sql`SELECT partner_code AS c FROM partners WHERE id = ${b}`)).c, 'Visited with the partner before registering', 'Staff A');
    await refresh();
    expect((await one<{ on_hold: boolean }>(sql`SELECT on_hold FROM partner_commissions WHERE voucher_no = ${early}`)).on_hold).toBe(true);
    const flag = await one<{ id: number }>(sql`SELECT id FROM partner_flags WHERE kind = 'retro_attribution' AND voucher_no = ${early}`);
    await fails(P.resolveFlag(flag.id, 'cleared', 'ok', 'staff a'), /someone other/);
    await P.resolveFlag(flag.id, 'cleared', 'Confirmed with the store', 'Manager');
    await refresh();
    expect((await one<{ on_hold: boolean }>(sql`SELECT on_hold FROM partner_commissions WHERE voucher_no = ${early}`)).on_hold).toBe(false);
  });

  it('17: a month with no eligible sales has no commission, no bonus and no statement', async () => {
    const a = await partner(month(8));
    const v = await sale(a, month(2), 120000, 0);
    await db.execute(sql`UPDATE sales SET fully_returned = true WHERE voucher_no = ${v}`);
    await refresh();
    const m = await monthRow(a, month(2));
    expect([Number(m.eligible_sales), Number(m.commission), Number(m.bonus)]).toEqual([0, 0, 0]);
    expect(await stmt(a, month(2))).toBeNull();
  });

  it('18: a negative manual adjustment carries forward as the next opening balance', async () => {
    const a = await partner(month(8));
    await P.addAdjustment(a, month(3), -5000, 'Recovered an overpayment', 'Accounts One');
    const adj = await one<{ id: number }>(sql`SELECT id FROM partner_adjustments WHERE partner_id = ${a}`);
    await fails(P.approveAdjustment(adj.id, 'accounts one'), /someone else/);
    await P.approveAdjustment(adj.id, 'Manager');
    await refresh();
    const s = (await stmt(a, month(1)))!;
    expect(s.net).toBe(-5000);
    expect(await P.verifySettlement(s.id, 'Accounts One')).toBe('verified');
    // Next month's sales open with −₹5,000.
    await sale(a, rules.thisMonthIst(), 10000, 0);
    const opening = await one<{ c: string }>(sql`SELECT closing_balance AS c FROM partner_settlements WHERE id = ${s.id}`);
    expect(Number(opening.c)).toBe(-5000);
  });

  it('19: collaborations within the previous month level limit; above it only with an exception; honoured once approved', async () => {
    const a = await partner(month(8));
    const lim = await P.collaborationLimit(a);
    await P.requestCollaboration(a, { entity: 'Deepam by Ananta', title: 'Reel', deliverables: '2 reels', dueOn: `${rules.thisMonthIst()}-28`, amount: lim.limit + 1000, by: 'Marketing' });
    const c = await one<{ id: number }>(sql`SELECT id FROM partner_collaborations WHERE partner_id = ${a}`);
    await fails(P.decideCollaboration(c.id, 'approve', null, 'Manager'), /over the Level/);
    await P.decideCollaboration(c.id, 'approve', 'Wedding season launch', 'Manager');
    await P.completeCollaboration(c.id, 'Marketing');
    const row = await one<{ status: string; exception_reason: string; limit_at_approval: string }>(sql`SELECT * FROM partner_collaborations WHERE id = ${c.id}`);
    expect([row.status, row.exception_reason, Number(row.limit_at_approval)]).toEqual(['completed', 'Wedding season launch', lim.limit]);
  });

  it('fraud: a self referral is flagged, and a confirmed flag means the bill never earns', async () => {
    const a = await partner(month(8));
    const name = (await one<{ n: string }>(sql`SELECT full_name AS n FROM partners WHERE id = ${a}`)).n;
    const c = await customer();
    await db.execute(sql`INSERT INTO partner_referrals (partner_id, full_name, contact, phone_e164, customer_id, occasion, consent_at, status, registered_at, registered_on, window_ends_on)
      VALUES (${a}, ${name}, ${c.phone}, ${c.phone}, ${c.id}, 'Wedding', now(), 'registered', now(), ${month(2) + '-01'}::date, ${month(2) + '-01'}::date + 30)`);
    const v = await bill(c, month(2), 90000);
    await P.raiseFlag(a, v, 'Looks like the partner bought for themselves', 'Store manager');
    await refresh();
    expect((await rows(sql`SELECT 1 FROM partner_flags WHERE kind = 'self_referral' AND partner_id = ${a}`)).length).toBe(1);
    const f = await one<{ id: number }>(sql`SELECT id FROM partner_flags WHERE kind = 'manual' AND voucher_no = ${v}`);
    await P.resolveFlag(f.id, 'confirmed', 'Partner confirmed it was their purchase', 'Manager');
    await refresh();
    expect((await one<{ excluded: boolean }>(sql`SELECT excluded FROM partner_commissions WHERE voucher_no = ${v}`)).excluded).toBe(true);
  });
}, 120_000);
