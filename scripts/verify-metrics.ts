/**
 * The Phase 4 acceptance test.
 *
 * Computes the dashboard metrics straight from the database and checks them
 * against DECISIONS.md §Q. If these reconcile, the ingestion + attribution
 * layers are correct end to end.
 *
 *   npx tsx scripts/verify-metrics.ts
 *
 * Baselined against the cleaned master workbook (D-84). Every figure below was
 * re-derived after that load replaced the per-channel exports; the pre-master
 * numbers are kept in DECISIONS.md §Q, not here. The four channels are Meta,
 * WhatsApp, Google Ads and Others — `walkin` no longer exists as a channel and
 * `self_declared` is no longer a reachable lifecycle basis, because the walk-in
 * form was the only thing that ever set it.
 */

import '../src/db/load-env';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';
import {
  getKpis,
  getChannelBreakdown,
  getListOverlap,
} from '../src/lib/queries/dashboard';

type Row = Record<string, unknown>;

async function q(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

let failures = 0;
function check(label: string, actual: number | string, expected: number | string) {
  const pass = String(actual) === String(expected);
  if (!pass) failures++;
  console.log(
    `  ${pass ? '✓' : '✗'} ${label.padEnd(38)} ${String(actual).padStart(14)}` +
      (pass ? '' : `   expected ${expected}`),
  );
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '0.0');

async function main() {
  console.log('\nDashboard metrics, computed from the database\n');

  console.log('SOURCES (lead touches by channel)');
  for (const r of await q(`
    SELECT lt.channel::text AS channel,
           COUNT(DISTINCT lt.customer_id)::int AS people,
           COUNT(*)::int AS touches
    FROM lead_touches lt GROUP BY 1 ORDER BY people DESC`)) {
    console.log(
      `  ${String(r.channel).padEnd(12)} ${String(r.people).padStart(6)} people` +
        `   ${String(r.touches).padStart(6)} touches`,
    );
  }

  const [union] = await q(
    `SELECT COUNT(DISTINCT customer_id)::int AS n FROM lead_touches`,
  );
  check('union of all leads', Number(union.n), 5866);

  const [multi] = await q(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT customer_id FROM lead_touches
      GROUP BY customer_id HAVING COUNT(DISTINCT channel) > 1) x`);
  check('multi-channel people', Number(multi.n), 298);

  console.log('\nCHANNEL OVERLAP (D-40)');
  for (const [a, b, expected] of [
    ['meta', 'whatsapp', 227],
    ['meta', 'other', 51],
    ['whatsapp', 'other', 25],
    ['meta', 'google', 1],
  ] as const) {
    const [r] = await q(`
      SELECT COUNT(*)::int AS n FROM (
        SELECT customer_id FROM lead_touches WHERE channel = '${a}'
        INTERSECT
        SELECT customer_id FROM lead_touches WHERE channel = '${b}') x`);
    check(`${a} ∩ ${b}`, Number(r.n), expected);
  }

  console.log('\nLIFECYCLE (D-36)');
  for (const r of await q(`
    SELECT lifecycle::text, COALESCE(lifecycle_basis::text,'—') AS basis, COUNT(*)::int AS n
    FROM customers GROUP BY 1,2 ORDER BY n DESC`)) {
    console.log(
      `  ${String(r.lifecycle).padEnd(10)} ${String(r.basis).padEnd(16)} ${String(r.n).padStart(6)}`,
    );
  }
  const [matched] = await q(
    `SELECT COUNT(*)::int AS n FROM customers WHERE lifecycle_basis = 'lead_matched'`,
  );
  check('new — lead matched', Number(matched.n), 5866);
  const [inf] = await q(
    `SELECT COUNT(*)::int AS n FROM customers WHERE lifecycle_basis = 'no_lead_match'`,
  );
  check('existing — inferred', Number(inf.n), 284);
  // The master sheet dropped the walk-in form, which was the only source of a
  // self-declared "I'm already a customer". 143 people who told us so are now
  // classified as new acquisitions. Asserted at zero so the day an export
  // restores that evidence, this test fails loudly instead of drifting. (D-84)
  const [decl] = await q(
    `SELECT COUNT(*)::int AS n FROM customers WHERE lifecycle_basis = 'self_declared'`,
  );
  check('existing — declared (lost with walk-in)', Number(decl.n), 0);

  console.log('\nATTRIBUTION (exclusive, existing-first)');
  const rows = await q(`
    SELECT ca.primary_channel::text AS channel,
           COUNT(*)::int AS people,
           COUNT(*) FILTER (WHERE ca.converted)::int AS buyers,
           COALESCE(ROUND(SUM(ca.total_sales)),0)::bigint AS revenue,
           ca.lifecycle_basis::text AS basis
    FROM   customer_attribution ca
    GROUP  BY 1, 5 ORDER BY people DESC`);
  console.log(
    `  ${'segment'.padEnd(22)}${'people'.padStart(8)}${'buyers'.padStart(8)}${'cvr'.padStart(8)}${'revenue'.padStart(18)}`,
  );
  for (const r of rows) {
    const label =
      r.channel === 'existing' ? `existing (${r.basis})` : String(r.channel);
    console.log(
      `  ${label.padEnd(22)}${String(r.people).padStart(8)}${String(r.buyers).padStart(8)}` +
        `${(pct(Number(r.buyers), Number(r.people)) + '%').padStart(8)}` +
        `${inr(Number(r.revenue)).padStart(18)}`,
    );
  }

  for (const [channel, people, buyers] of [
    ['meta', 1924, 150],
    ['whatsapp', 3562, 46],
    ['other', 367, 164],
    ['google', 13, 6],
  ] as const) {
    const [r] = await q(`
      SELECT COUNT(*)::int AS people, COUNT(*) FILTER (WHERE converted)::int AS buyers
      FROM customer_attribution WHERE primary_channel = '${channel}'`);
    check(`${channel} people`, Number(r.people), people);
    check(`${channel} buyers`, Number(r.buyers), buyers);
  }

  console.log('\nHEADLINE KPIs (§7)');
  const [kpi] = await q(`
    WITH funnel AS (
      SELECT COUNT(*)::int AS leads,
             COUNT(*) FILTER (WHERE converted)::int AS converted,
             COALESCE(ROUND(SUM(total_sales) FILTER (WHERE converted)),0)::bigint AS new_rev
      FROM   customer_attribution WHERE in_acquisition_funnel
    ),
    existing AS (
      SELECT COUNT(*)::int AS people,
             COUNT(*) FILTER (WHERE converted)::int AS buyers,
             COALESCE(ROUND(SUM(total_sales)),0)::bigint AS rev
      FROM   customer_attribution WHERE lifecycle = 'existing'
    ),
    gross AS (
      SELECT ROUND(SUM(bill_amount))::bigint AS total,
             COALESCE(ROUND(SUM(bill_amount) FILTER (WHERE customer_id IS NULL)),0)::bigint AS phoneless
      FROM   sales
    )
    SELECT f.leads, f.converted, f.new_rev, e.people AS ex_people, e.buyers AS ex_buyers,
           e.rev AS ex_rev, g.total AS gross, g.phoneless
    FROM funnel f, existing e, gross g`);

  check('Total Leads', Number(kpi.leads), 5866);
  check('Leads Converted', Number(kpi.converted), 366);
  check('Total Sales (gross)', Number(kpi.gross), 20103733);
  check(
    'Conversion Rate',
    pct(Number(kpi.converted), Number(kpi.leads)) + '%',
    '6.2%',
  );
  check('New-customer revenue', Number(kpi.new_rev), 10467354);
  check('Existing customers', Number(kpi.ex_people), 284);
  check('Existing buyers', Number(kpi.ex_buyers), 284);
  check('Existing revenue', Number(kpi.ex_rev), 7920018);
  check('Phone-less revenue', Number(kpi.phoneless), 1716361);

  console.log('\nINVARIANTS (D-50)');
  check(
    'new + existing + phoneless = gross',
    Number(kpi.new_rev) + Number(kpi.ex_rev) + Number(kpi.phoneless),
    Number(kpi.gross),
  );
  const [chan] = await q(`
    SELECT COALESCE(ROUND(SUM(total_sales)),0)::bigint AS n FROM customer_attribution`);
  check(
    'channel revenue = gross - phoneless',
    Number(chan.n),
    Number(kpi.gross) - Number(kpi.phoneless),
  );

  // The matview is not what the page reads. `dashboard.ts` recomputes first
  // touch over `lead_touches` so that leads later found to be existing keep
  // their channel instead of collapsing into 'existing'. The two agree today
  // only because all 284 existing customers have no lead touch at all — assert
  // the page's own numbers so a scope change cannot pass on the matview alone.
  console.log('\nDASHBOARD SCOPE (D-86)');
  const kpis = await getKpis();
  check('scoped total leads', kpis.totalLeads, 5866);
  check('scoped leads converted', kpis.leadsConverted, 366);
  check('scoped conversion rate', kpis.conversionRate.toFixed(2) + '%', '6.24%');
  check('scoped attributed revenue', Math.round(kpis.attributedRevenue), 10467354);
  // The segment tiles. `existing` is business-wide on purpose: sourcing it from
  // the lead scope returned 0, because an existing customer is defined by
  // having no lead record. Asserted here so the tile cannot silently empty.
  check('segment new revenue', Math.round(kpis.newRevenue), 10467354);
  check('segment existing people', kpis.existingPeople, 284);
  check('segment existing buyers', kpis.existingBuyers, 284);
  check('segment existing revenue', Math.round(kpis.existingRevenue), 7920018);
  // The "Total sales" tile tells the reader the three tiles beside it sum to
  // it. Both halves of that claim are asserted here so the copy cannot outlive
  // the arithmetic.
  check(
    'new + existing + phone-less = gross',
    Math.round(kpis.newRevenue + kpis.existingRevenue + kpis.phonelessRevenue),
    Math.round(kpis.grossSales),
  );
  check(
    'their bills sum to total bills',
    kpis.attributedBills + kpis.existingBills + kpis.phonelessBills,
    kpis.totalBills,
  );

  const breakdown = await getChannelBreakdown();
  for (const [channel, people, buyers] of [
    ['whatsapp', 3562, 46],
    ['meta', 1924, 150],
    ['other', 367, 164],
    ['google', 13, 6],
  ] as const) {
    const row = breakdown.find((r) => r.channel === channel);
    check(`scoped ${channel}`, `${row?.people ?? 0}/${row?.buyers ?? 0}`, `${people}/${buyers}`);
  }
  check('scoped channels reported', breakdown.length, 4);
  check(
    'channel rows sum to total leads',
    breakdown.reduce((n, r) => n + r.people, 0),
    kpis.totalLeads,
  );

  // Unlike per-channel reach, these rows are disjoint sets and must reconcile
  // to the distinct totals — that is the whole reason the table replaced it.
  console.log('\nLIST OVERLAP (D-40)');
  const overlap = await getListOverlap();
  for (const c of overlap.combinations) {
    console.log(
      `  ${c.channels.join(' + ').padEnd(28)}${String(c.people).padStart(6)} people` +
        `${String(c.buyers).padStart(6)} bought`,
    );
  }
  check('on exactly one list', overlap.onOneList, 5568);
  check('on two lists', overlap.onTwoLists, 295);
  check('on all three', overlap.onThreeOrMore, 3);
  check(
    'cardinalities sum to distinct people',
    overlap.onOneList + overlap.onTwoLists + overlap.onThreeOrMore,
    overlap.totalPeople,
  );
  check('combination people sum to leads', overlap.totalPeople, kpis.totalLeads);
  check('combination buyers sum to converted', overlap.totalBuyers, kpis.leadsConverted);

  console.log('\nNAME TRUST (D-24)');
  for (const r of await q(`
    SELECT COALESCE(name_source,'(none)') AS src, COUNT(*)::int AS n
    FROM customers WHERE full_name IS NOT NULL GROUP BY 1 ORDER BY n DESC`)) {
    console.log(`  ${String(r.src).padEnd(12)} ${String(r.n).padStart(6)}`);
  }

  console.log('\nFOLLOW-UP OUTCOMES (D-67)');
  for (const r of await q(`
    SELECT final_remark::text AS remark, COUNT(*)::int AS n
    FROM lead_followups GROUP BY 1 ORDER BY n DESC`)) {
    console.log(`  ${String(r.remark).padEnd(16)} ${String(r.n).padStart(6)}`);
  }

  console.log(`\n${failures === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});
