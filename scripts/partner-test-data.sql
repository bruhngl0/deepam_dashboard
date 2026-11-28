-- Ananta Partner Network TEST data (owner, 28 Nov 2026): about 30 rows on every Partner Network page, on the live CRM.
-- Every row is marked so scripts/partner-test-data-remove.sql takes all of it out:
--   partners    "TEST …" names, phones +91 90000 00001–00030, Partner IDs APR-90001–APR-90030, notes 'TEST DATA'
--   referrals   phones +91 90001 00001–…        bills / invoices  TEST-INV-…, TEST-PP-…, TEST-EXCL-…
--   campaigns, incentives, claims, exclusions   names / reasons starting "TEST"; created_by 'TEST seed'
-- Inserted with SQL, so no alert emails or Marketing follow-ups are made. Rules and categories are not touched.
-- Run once; it stops if test partners already exist. Afterwards the app's own functions work out months and statements.
BEGIN;
DO $$
DECLARE
  names text[] := ARRAY['Asha Rao','Priya Menon','Kavya Iyer','Ritu Sharma','Neha Kapoor','Divya Reddy','Ananya Gupta','Meera Nair',
    'Sneha Patil','Pooja Joshi','Lakshmi Prasad','Swati Desai','Rhea Bhatia','Nandini Shetty','Tanvi Kulkarni','Aditi Verma',
    'Ishita Malhotra','Shreya Pillai','Bhavna Shah','Rekha Krishnan','Farah Khan','Simran Kaur','Deepa Hegde','Kiran Rao',
    'Vidya Subramanian','Gauri Mehta','Harini Raman','Jaya Chandran','Mitali Sen','Ruchi Agarwal'];
  cats text[]; cities text[] := ARRAY['Bengaluru','Mumbai','Surat','Chennai','Hyderabad'];
  st text[] := ARRAY['applied','on_hold','suspended','rejected','terminated','applied','applied','applied','applied','applied'];
  mg int; jy int; pid int; rid bigint; s text; lvl int; reg date; bill numeric; billed timestamptz; mon text; i int; sid int;
  pids int[] := '{}'; rids bigint[] := '{}';
BEGIN
  IF EXISTS (SELECT 1 FROM partners WHERE phone_e164 LIKE '+9190000%' OR partner_code LIKE 'APR-9%') THEN
    RAISE EXCEPTION 'Test partners are already there: run partner-test-data-remove.sql first';
  END IF;
  IF EXISTS (SELECT 1 FROM customers WHERE phone_e164 LIKE '+9190000%' OR phone_e164 LIKE '+9190001%') THEN
    RAISE EXCEPTION 'A real customer uses a +91 90000/90001 number; pick other test numbers';
  END IF;
  SELECT array_agg(name ORDER BY name) INTO cats FROM partner_categories;
  IF cats IS NULL THEN cats := ARRAY['Makeup artist','Stylist','Photographer']; END IF;
  SELECT id INTO mg FROM stores WHERE code = 'MG_ROAD';
  SELECT id INTO jy FROM stores WHERE code = 'JAYANAGAR';

  -- Partners: 20 active, the rest across every other status.
  FOR i IN 1..30 LOOP
    s := CASE WHEN i <= 20 THEN 'approved' ELSE st[i - 20] END;
    lvl := CASE WHEN i <= 20 THEN 1 + (i % 5) ELSE 1 END;
    INSERT INTO partners (partner_code, full_name, contact, phone_e164, email, category, city, consent_at, status, status_note, level,
                          documents, dashboard_token, notes, applied_at, approved_at, decided_at)
    VALUES (CASE WHEN s IN ('approved','on_hold','suspended','terminated') THEN 'APR-9' || lpad(i::text, 4, '0') END,
            'TEST ' || names[i], '90000 ' || lpad(i::text, 5, '0'), '+9190000' || lpad(i::text, 5, '0'),
            'test.partner' || i || '@example.com', cats[1 + (i % array_length(cats, 1))], cities[1 + (i % 5)], now() - (i + 60) * interval '1 day',
            s, CASE s WHEN 'applied' THEN NULL WHEN 'approved' THEN 'Application approved' ELSE 'TEST: ' || s END, lvl,
            CASE WHEN s = 'approved' THEN jsonb_build_object('agreement', '2026-10-05', 'pan', '2026-10-05', 'id_proof', '2026-10-06', 'bank', '2026-10-06')
                 WHEN s = 'applied' AND i % 2 = 0 THEN jsonb_build_object('agreement', '2026-11-20') ELSE '{}'::jsonb END,
            CASE WHEN s IN ('approved','on_hold','suspended','terminated') THEN 'test' || md5(random()::text) || md5(random()::text) END,
            'TEST DATA', now() - (i + 60) * interval '1 day',
            CASE WHEN s IN ('approved','on_hold','suspended','terminated') THEN now() - (i + 50) * interval '1 day' END,
            CASE WHEN s <> 'applied' THEN now() - (i + 50) * interval '1 day' END)
    RETURNING id INTO pid;
    pids := pids || pid;
    INSERT INTO partner_status_log (partner_id, from_status, to_status, reason, changed_by, changed_at)
    VALUES (pid, NULL, 'applied', 'TEST: applied online', 'TEST seed', now() - (i + 60) * interval '1 day');
    IF s <> 'applied' THEN
      INSERT INTO partner_status_log (partner_id, from_status, to_status, reason, changed_by, changed_at)
      VALUES (pid, 'applied', CASE WHEN s = 'rejected' THEN 'rejected' ELSE 'approved' END, 'TEST: decision', 'TEST seed', now() - (i + 50) * interval '1 day');
      IF s NOT IN ('approved','rejected') THEN
        INSERT INTO partner_status_log (partner_id, from_status, to_status, reason, changed_by) VALUES (pid, 'approved', s, 'TEST: ' || s, 'TEST seed');
      END IF;
    END IF;
    IF i <= 20 AND lvl > 1 THEN
      INSERT INTO partner_level_reviews (partner_id, kind, previous_level, new_level, effective_month, note, changed_by)
      VALUES (pid, 'manual', 1, lvl, '2026-11', 'TEST: level set for test data', 'TEST seed');
    END IF;
  END LOOP;

  -- Referrals: 45 on the active partners, Deepam and Kalaniketan, every outcome.
  FOR i IN 1..45 LOOP
    pid := pids[1 + ((i - 1) % 20)];
    reg := date '2026-09-05' + ((i * 2) % 80);
    s := CASE WHEN i % 9 = 0 THEN 'declined' WHEN i <= 30 THEN 'converted' WHEN reg + 30 < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'expired' ELSE 'registered' END;
    INSERT INTO partner_referrals (partner_id, full_name, contact, phone_e164, occasion, preferred_store_id, appointment_date, consent_at, status,
                                   decline_reason, registered_at, registered_on, window_ends_on, converted_at, verify_status, brand, preferred_store_label)
    VALUES (pid, 'TEST Customer ' || i, '90001 ' || lpad(i::text, 5, '0'), '+9190001' || lpad(i::text, 5, '0'),
            (ARRAY['Wedding','Engagement','Reception','Festival','Gifting','Everyday wear'])[1 + (i % 6)],
            CASE i % 4 WHEN 0 THEN mg WHEN 1 THEN jy END, reg + 3, reg, s,
            CASE WHEN s = 'declined' THEN 'already_referred' END, reg + time '11:00', reg, reg + 30,
            CASE WHEN s = 'converted' THEN reg + 5 + time '16:00' END,
            CASE WHEN s = 'registered' AND i % 3 = 0 THEN 'pending' END,
            CASE WHEN i % 4 IN (0, 1) THEN 'deepam' ELSE 'kalaniketan' END,
            CASE i % 4 WHEN 0 THEN 'Deepam MG Road, Bengaluru' WHEN 1 THEN 'Deepam Jayanagar, Bengaluru' WHEN 2 THEN 'Kalaniketan Juhu, Mumbai' ELSE 'Kalaniketan Ghod Dod Road, Surat' END)
    RETURNING id INTO rid;
    rids := rids || rid;
    -- A bill for every converted referral. Settled months are paid; this month's lines are validated or attached by hand
    -- (retro), so the nightly matching, which drops pending lines with no real bill, keeps them.
    IF s = 'converted' THEN
      bill := 35000 + ((i * 37) % 23) * 9000;
      billed := reg + 5 + time '16:00';
      mon := to_char(billed AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM');
      INSERT INTO partner_commissions (referral_id, partner_id, voucher_no, store_id, billed_at, bill_amount, net_amount, status, level,
                                       commission_percent, commission_amount, payout_month, note, validated_at, paid_at, payout_reference, retro, retro_reason, retro_requested_by, retro_approved_by)
      VALUES (rid, pid, 'TEST-INV-' || lpad(i::text, 4, '0'), CASE i % 4 WHEN 0 THEN mg WHEN 1 THEN jy END, billed, bill, round(bill / 1.05, 2),
              CASE WHEN mon < '2026-11' THEN 'paid' WHEN i % 2 = 0 THEN 'validated' ELSE 'pending' END,
              CASE WHEN mon < '2026-11' OR i % 2 = 0 THEN 1 END, CASE WHEN mon < '2026-11' OR i % 2 = 0 THEN 10 END,
              CASE WHEN mon < '2026-11' OR i % 2 = 0 THEN round(bill / 1.05 * 0.10, 2) END,
              CASE WHEN mon < '2026-11' OR i % 2 = 0 THEN mon END, 'TEST DATA',
              CASE WHEN mon < '2026-11' OR i % 2 = 0 THEN billed + interval '3 days' END,
              CASE WHEN mon < '2026-11' THEN billed + interval '20 days' END,
              CASE WHEN mon < '2026-11' THEN 'TEST-UTR-' || i END,
              mon >= '2026-11' AND i % 2 = 1, CASE WHEN mon >= '2026-11' AND i % 2 = 1 THEN 'TEST data' END,
              CASE WHEN mon >= '2026-11' AND i % 2 = 1 THEN 'TEST seed' END, CASE WHEN mon >= '2026-11' AND i % 2 = 1 THEN 'TEST seed' END);
    END IF;
  END LOOP;

  FOR i IN 1..30 LOOP
    pid := pids[1 + ((i - 1) % 20)];
    INSERT INTO partner_campaigns (name, starts_on, ends_on, store_codes, commission_percent, priority, counts_toward_level, bonus_eligible,
                                   status, notes, created_by, approved_by, approved_at)
    VALUES ('TEST Campaign ' || i || ' · ' || (ARRAY['Wedding season','Diwali','Bridal week','Silk festival','New collection'])[1 + (i % 5)],
            date '2027-01-01' + i * 7, date '2027-01-01' + i * 7 + 14, CASE WHEN i % 2 = 0 THEN '{MG_ROAD}'::text[] ELSE '{JAYANAGAR,MG_ROAD}'::text[] END,
            12 + (i % 4), 100 + i, i % 3 <> 0, i % 4 <> 0, CASE WHEN i % 3 = 0 THEN 'draft' WHEN i % 3 = 1 THEN 'active' ELSE 'ended' END,
            'TEST DATA', 'TEST seed', CASE WHEN i % 3 <> 0 THEN 'TEST approver' END, CASE WHEN i % 3 <> 0 THEN now() END);
    INSERT INTO partner_exclusions (scope, value, from_on, to_on, reason, created_by)
    VALUES ('invoice', 'TEST-EXCL-' || lpad(i::text, 4, '0'), date '2026-11-01', CASE WHEN i % 2 = 0 THEN date '2026-12-31' END, 'TEST: excluded invoice ' || i, 'TEST seed');
    INSERT INTO partner_claims (voucher_no, claimant_type, claimant_name, note, status, resolution, partner_share_percent, resolved_by, resolved_reason, resolved_at, created_by)
    -- Only a few claims and flags sit on test bills (an open one holds the bill's commission); the rest name other invoices.
    VALUES (CASE WHEN i IN (3, 13) THEN 'TEST-INV-' || lpad(i::text, 4, '0') ELSE 'TEST-CLM-' || lpad(i::text, 4, '0') END,
            (ARRAY['partner','driver','travel_agent','affiliate','other'])[1 + (i % 5)], 'TEST Claimant ' || i,
            'TEST DATA', CASE WHEN i <= 12 THEN 'resolved' ELSE 'open' END,
            CASE WHEN i <= 12 THEN (ARRAY['partner','other','shared'])[1 + (i % 3)] END,
            CASE WHEN i <= 12 AND i % 3 = 2 THEN 50 END, CASE WHEN i <= 12 THEN 'TEST seed' END, CASE WHEN i <= 12 THEN 'TEST resolution' END,
            CASE WHEN i <= 12 THEN now() END, 'TEST seed');
    INSERT INTO partner_flags (kind, partner_id, voucher_no, referral_id, detail, status, resolved_by, resolved_reason, resolved_at, created_by)
    VALUES ((ARRAY['self_referral','duplicate_registration','repeated_returns','large_bill','unusual_adjustment','manual'])[1 + (i % 6)], pid,
            CASE WHEN i IN (4, 16) THEN 'TEST-INV-' || lpad(i::text, 4, '0') END, rids[i], 'TEST: flag ' || i, CASE WHEN i <= 10 THEN 'cleared' WHEN i <= 15 THEN 'confirmed' ELSE 'open' END,
            CASE WHEN i <= 15 THEN 'TEST seed' END, CASE WHEN i <= 15 THEN 'TEST review' END, CASE WHEN i <= 15 THEN now() END, 'TEST seed');
    SELECT level INTO lvl FROM partners WHERE id = pid;
    bill := 20000 + i * 1500;
    INSERT INTO partner_personal_purchases (partner_id, voucher_no, purchase_on, year, purchase_value, partnership_level, discount_percent,
                                            eligible_value, discount_amount, otp_verified, note, recorded_by)
    VALUES (pid, 'TEST-PP-' || lpad(i::text, 4, '0'), date '2026-10-01' + i * 2, 2026, bill, lvl, (ARRAY[0,10,10,15,20])[lvl], bill,
            round(bill * (ARRAY[0,10,10,15,20])[lvl] / 100.0, 2), true, 'TEST DATA', 'TEST seed');
    INSERT INTO partner_collaborations (partner_id, entity, title, deliverables, due_on, amount, status, approval_month, limit_at_approval,
                                        requested_by, approved_by, approved_at, rejected_reason, completed_by, completed_at)
    VALUES (pid, CASE WHEN i % 2 = 0 THEN 'Deepam by Ananta' ELSE 'Kalaniketan' END, 'TEST Collaboration ' || i,
            '1 reel and 3 stories', date '2026-12-01' + i, 5000 + (i % 6) * 2500,
            (ARRAY['pending','approved','rejected','completed'])[1 + (i % 4)],
            CASE WHEN i % 4 IN (1, 3) THEN '2026-11' END, CASE WHEN i % 4 IN (1, 3) THEN 50000 END, 'TEST seed',
            CASE WHEN i % 4 IN (1, 3) THEN 'TEST approver' END, CASE WHEN i % 4 IN (1, 3) THEN now() END,
            CASE WHEN i % 4 = 2 THEN 'TEST: over budget' END, CASE WHEN i % 4 = 3 THEN 'TEST seed' END, CASE WHEN i % 4 = 3 THEN now() END);
    INSERT INTO partner_incentives (name, kind, min_sales, months, starts_on, ends_on, reward, max_payout, entity, status, notes, created_by, approved_by, approved_at)
    VALUES ('TEST Incentive ' || i, (ARRAY['first_sale','monthly_sales','consistency','manual'])[1 + (i % 4)],
            CASE WHEN i % 4 IN (1, 2) THEN 200000 + i * 10000 ELSE 0 END, CASE WHEN i % 4 = 2 THEN 3 ELSE 1 END,
            date '2027-01-01', date '2027-03-31', 1000 + i * 250, 50000, CASE WHEN i % 2 = 0 THEN 'Deepam by Ananta' END,
            CASE WHEN i % 3 = 0 THEN 'draft' ELSE 'active' END, 'TEST DATA', 'TEST seed',
            CASE WHEN i % 3 <> 0 THEN 'TEST approver' END, CASE WHEN i % 3 <> 0 THEN now() END)
    RETURNING id INTO sid;
    INSERT INTO partner_incentive_awards (incentive_id, partner_id, month, amount, auto, note, awarded_by)
    VALUES (sid, pid, '2026-11', 1000 + i * 250, false, 'TEST DATA', 'TEST seed');
    INSERT INTO partner_adjustments (partner_id, kind, month, amount, reason, created_by, approved_by)
    VALUES (pid, 'manual', '2026-11', CASE WHEN i % 3 = 0 THEN -500 - i * 10 ELSE 750 + i * 20 END, 'TEST adjustment ' || i, 'TEST seed',
            CASE WHEN i % 2 = 0 THEN 'TEST approver' END);
  END LOOP;
END $$;

-- The app's own arithmetic: commission months, then a statement for every active test partner (Oct and Nov).
SELECT partner_refresh_months();
INSERT INTO partner_settlements (partner_id, month)
SELECT p.id, m.month FROM partners p CROSS JOIN (VALUES ('2026-10'), ('2026-11')) m(month)
WHERE p.notes = 'TEST DATA' AND p.status = 'approved' AND (m.month = '2026-11' OR p.partner_code <= 'APR-90010')
ON CONFLICT (partner_id, month) DO NOTHING;
SELECT partner_compute_settlement(s.id) FROM partner_settlements s JOIN partners p ON p.id = s.partner_id WHERE p.notes = 'TEST DATA';
-- Statements through every stage.
UPDATE partner_settlements s SET
  status = (ARRAY['pending_verification','verified','approved','on_hold','paid','partially_paid'])[1 + (s.id % 6)],
  verified_by = CASE WHEN s.id % 6 >= 1 THEN 'TEST verifier' END, verified_at = CASE WHEN s.id % 6 >= 1 THEN now() END,
  approved_by = CASE WHEN s.id % 6 IN (2, 4, 5) THEN 'TEST approver' END, approved_at = CASE WHEN s.id % 6 IN (2, 4, 5) THEN now() END,
  hold_reason = CASE WHEN s.id % 6 = 3 THEN 'TEST: documents being checked' END, held_by = CASE WHEN s.id % 6 = 3 THEN 'TEST seed' END,
  updated_at = now()
FROM partners p WHERE p.id = s.partner_id AND p.notes = 'TEST DATA';
INSERT INTO partner_settlement_payments (settlement_id, amount, paid_on, reference, recorded_by)
SELECT s.id, CASE WHEN s.status = 'paid' THEN s.net_payable ELSE round(s.net_payable / 2, 2) END, date '2026-11-25', 'TEST-UTR-S' || s.id, 'TEST seed'
FROM partner_settlements s JOIN partners p ON p.id = s.partner_id
WHERE p.notes = 'TEST DATA' AND s.status IN ('paid', 'partially_paid') AND s.net_payable > 0;
UPDATE partner_settlements s SET paid_amount = x.paid, closing_balance = s.net_payable - x.paid
FROM (SELECT settlement_id, sum(amount) AS paid FROM partner_settlement_payments GROUP BY 1) x, partners p
WHERE x.settlement_id = s.id AND p.id = s.partner_id AND p.notes = 'TEST DATA';
COMMIT;

SELECT 'partners' AS t, count(*) FROM partners WHERE notes = 'TEST DATA'
UNION ALL SELECT 'referrals', count(*) FROM partner_referrals WHERE phone_e164 LIKE '+9190001%'
UNION ALL SELECT 'commissions', count(*) FROM partner_commissions WHERE voucher_no LIKE 'TEST-INV-%'
UNION ALL SELECT 'settlements', count(*) FROM partner_settlements s JOIN partners p ON p.id = s.partner_id WHERE p.notes = 'TEST DATA'
UNION ALL SELECT 'campaigns', count(*) FROM partner_campaigns WHERE created_by = 'TEST seed'
UNION ALL SELECT 'claims', count(*) FROM partner_claims WHERE created_by = 'TEST seed'
UNION ALL SELECT 'flags', count(*) FROM partner_flags WHERE created_by = 'TEST seed';
