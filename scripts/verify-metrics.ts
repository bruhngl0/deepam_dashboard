/**
 * The Phase 4 acceptance test.
 *
 * Computes the dashboard metrics straight from the database and checks them
 * against SYSTEM_DESIGN.md §2.3 / DECISIONS.md §Q. If these reconcile, the
 * ingestion + attribution layers are correct end to end.
 *
 *   npx tsx scripts/verify-metrics.ts
 */

import '../src/db/load-env';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

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
  check('multi-channel people', Number(multi.n), 301);

  console.log('\nCHANNEL OVERLAP (D-40)');
  for (const [a, b, expected] of [
    ['meta', 'whatsapp', 198],
    ['meta', 'walkin', 80],
    ['whatsapp', 'walkin', 35],
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
  const [decl] = await q(
    `SELECT COUNT(*)::int AS n FROM customers WHERE lifecycle_basis = 'self_declared'`,
  );
  check('existing — declared', Number(decl.n), 143);
  const [inf] = await q(
    `SELECT COUNT(*)::int AS n FROM customers WHERE lifecycle_basis = 'no_lead_match'`,
  );
  check('existing — inferred', Number(inf.n), 284);

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
    ['meta', 1654, 29],
    ['whatsapp', 3471, 8],
    ['walkin', 598, 257],
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

  check('Total Leads', Number(kpi.leads), 5723);
  check('Leads Converted', Number(kpi.converted), 294);
  check('Total Sales (gross)', Number(kpi.gross), 20103733);
  check(
    'Conversion Rate',
    pct(Number(kpi.converted), Number(kpi.leads)) + '%',
    '5.1%',
  );
  check('New-customer revenue', Number(kpi.new_rev), 7748019);
  check('Existing customers', Number(kpi.ex_people), 427);
  check('Existing buyers', Number(kpi.ex_buyers), 356);
  check('Existing revenue', Number(kpi.ex_rev), 10639353);
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
