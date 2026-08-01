/**
 * Verifies what is actually in the database against the figures in
 * DECISIONS.md appendix Q. Queries the DB directly — it does not trust the
 * importer's own reporting.
 *
 *   npx tsx scripts/verify-db.ts
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
    `  ${pass ? '✓' : '✗'} ${label.padEnd(36)} ${String(actual).padStart(14)}` +
      (pass ? '' : `   expected ${expected}`),
  );
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

async function main() {
  console.log('\nVerifying database contents\n');

  console.log('SALES');
  const [s] = await q(`
    SELECT COUNT(*)::int                                   AS bills,
           ROUND(SUM(bill_amount))::bigint                 AS gross,
           COUNT(DISTINCT customer_id)::int                AS customers,
           COUNT(*) FILTER (WHERE customer_id IS NULL)::int AS phoneless,
           ROUND(SUM(bill_amount) FILTER (WHERE customer_id IS NULL))::bigint AS phoneless_rev,
           MIN(billed_at)::date::text                      AS from_date,
           MAX(billed_at)::date::text                      AS to_date
    FROM sales`);
  check('bills', Number(s.bills), 847);
  check('gross revenue', Number(s.gross), 20103733);
  check('distinct customers on bills', Number(s.customers), 650);
  check('bills with no customer', Number(s.phoneless), 66);
  check('revenue with no customer', Number(s.phoneless_rev), 1716361);
  console.log(`    date range (IST)                 ${s.from_date} → ${s.to_date}`);

  console.log('\nBY STORE');
  for (const r of await q(`
    SELECT st.name, st.voucher_prefix,
           COUNT(*)::int AS bills, ROUND(SUM(s.bill_amount))::bigint AS revenue
    FROM sales s JOIN stores st ON st.id = s.store_id
    GROUP BY st.name, st.voucher_prefix ORDER BY revenue DESC`)) {
    console.log(
      `  ${String(r.voucher_prefix)}  ${String(r.name).padEnd(12)} ` +
        `${String(r.bills).padStart(4)} bills   ${inr(Number(r.revenue)).padStart(15)}`,
    );
  }
  const [stores] = await q(
    `SELECT COUNT(DISTINCT store_id)::int AS n FROM sales`,
  );
  check('stores represented', Number(stores.n), 2);

  console.log('\nCUSTOMERS');
  const [c] = await q(`SELECT COUNT(*)::int AS n FROM customers`);
  check('customers created', Number(c.n), 650);
  const [named] = await q(
    `SELECT COUNT(*)::int AS n FROM customers WHERE full_name IS NOT NULL`,
  );
  console.log(`    with a name                      ${String(named.n).padStart(14)}`);

  console.log('\nLIFECYCLE (D-36)');
  for (const r of await q(`
    SELECT lifecycle::text, COALESCE(lifecycle_basis::text,'—') AS basis, COUNT(*)::int AS n
    FROM customers GROUP BY 1,2 ORDER BY n DESC`)) {
    console.log(
      `  ${String(r.lifecycle).padEnd(10)} ${String(r.basis).padEnd(16)} ${String(r.n).padStart(6)}`,
    );
  }
  // With sales loaded and no leads yet, every buyer is 'no_lead_match'.
  const [nolead] = await q(`
    SELECT COUNT(*)::int AS n FROM customers
    WHERE lifecycle = 'existing' AND lifecycle_basis = 'no_lead_match'`);
  check('existing via no_lead_match', Number(nolead.n), 650);

  console.log('\nATTRIBUTION VIEW');
  const [a] = await q(`
    SELECT COUNT(*)::int AS rows,
           COUNT(*) FILTER (WHERE converted)::int AS converted,
           COUNT(*) FILTER (WHERE in_acquisition_funnel)::int AS in_funnel,
           ROUND(SUM(total_sales))::bigint AS total
    FROM customer_attribution`);
  check('rows', Number(a.rows), 650);
  check('converted', Number(a.converted), 650);
  check('in acquisition funnel', Number(a.in_funnel), 0);
  check('attributed revenue', Number(a.total), 20103733 - 1716361);

  console.log('\nAUDIT');
  // Assert on the batches that actually own data, not on how many times someone
  // pressed import — re-running a committed file is legitimate and idempotent.
  const [b] = await q(`
    SELECT COUNT(*)::int AS batches, COALESCE(SUM(rows_ok),0)::int AS ok
    FROM   import_batches b
    WHERE  b.status = 'committed'
      AND  EXISTS (SELECT 1 FROM sales s WHERE s.batch_id = b.id)`);
  check('batches owning sales', Number(b.batches), 1);
  check('rows ok on those batches', Number(b.ok), 847);

  const [orphan] = await q(`
    SELECT COUNT(*)::int AS n FROM sales s
    LEFT JOIN import_batches b ON b.id = s.batch_id
    WHERE b.id IS NULL OR b.status <> 'committed'`);
  check('sales with no committed batch', Number(orphan.n), 0);

  const [rj] = await q(`
    SELECT COUNT(*)::int AS n
    FROM   import_rows_rejected r
    JOIN   import_batches b ON b.id = r.batch_id
    WHERE  r.error_code = 'voucher.missing' AND b.status = 'committed'`);
  check('totals row quarantined', Number(rj.n), 1);

  const batchList = await q(`
    SELECT status::text, COUNT(*)::int AS n FROM import_batches GROUP BY 1 ORDER BY 1`);
  console.log(
    `    batch history                    ` +
      batchList.map((r) => `${r.n} ${r.status}`).join(', '),
  );

  console.log('\nSPOT CHECK — first bill in the file');
  const [first] = await q(`
    SELECT voucher_no, billed_at AT TIME ZONE 'Asia/Kolkata' AS ist,
           customer_name_raw, bill_amount::numeric::text AS amt, payments::text
    FROM sales WHERE voucher_no = 'BK02-00670'`);
  console.log(`  ${first.voucher_no}  ${first.ist}  ${first.customer_name_raw}`);
  console.log(`  ₹${first.amt}  payments=${first.payments}`);
  check(
    'billed_at renders as 11:29:36 IST',
    String(first.ist).includes('11:29:36') ? 'yes' : String(first.ist),
    'yes',
  );

  console.log(`\n${failures === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});
