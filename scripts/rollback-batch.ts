/**
 * Roll back a committed import batch. (D-63)
 *
 *   npx tsx scripts/rollback-batch.ts               # list committed batches
 *   npx tsx scripts/rollback-batch.ts <batch-id>    # roll one back
 *
 * Removes everything the batch wrote, marks it rolled_back, then recomputes the
 * derived layer. Customers are never deleted — they may be referenced by other
 * batches, and nothing should ever delete a customer (§O).
 */

import '../src/db/load-env';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';
import { rollbackBatch } from '../src/lib/import/sales';

type Row = Record<string, unknown>;

async function q(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

async function main() {
  const batchId = process.argv[2];

  if (!batchId) {
    const batches = await q(`
      SELECT b.id, b.file_name, b.sheet_name, b.status, b.rows_ok, b.rows_rejected,
             b.created_at::timestamptz(0)::text AS created,
             (SELECT COUNT(*)::int FROM sales s WHERE s.batch_id = b.id) AS sales_rows
      FROM   import_batches b
      ORDER  BY b.created_at DESC`);

    console.log('\nIMPORT BATCHES\n');
    for (const b of batches) {
      console.log(
        `  ${b.id}  ${String(b.status).padEnd(11)} ${String(b.sales_rows).padStart(4)} sales  ` +
          `${b.created}  ${b.file_name}`,
      );
    }
    console.log('\n  Pass a batch id to roll it back.\n');
    return;
  }

  const [before] = await q(`SELECT COUNT(*)::int AS n FROM sales`);
  console.log(`\n  sales before  ${before.n}`);

  await rollbackBatch(batchId);

  const [after] = await q(`SELECT COUNT(*)::int AS n FROM sales`);
  console.log(`  sales after   ${after.n}`);
  console.log(`\n  ✓ batch ${batchId} rolled back\n`);
}

main().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});
