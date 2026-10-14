// Hands a salesperson more customers from the unassigned part of the exhibition
// calling list, leaving the customers they already have untouched.
//
//   npx tsx scripts/assign-more-existing-customers.ts "Abhishek Thapa" 300          # dry run
//   npx tsx scripts/assign-more-existing-customers.ts "Abhishek Thapa" 300 --apply
//
// Customers from the salesperson's own store come first, then the rest by list order.
import '../src/db/load-env';
import pg from 'pg';
import { EXHIBITION_LIST_KEY } from '../src/lib/marketing/existing-customer-import';

async function main() {
  const [salesperson, countArg] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const apply = process.argv.includes('--apply');
  const count = Number(countArg);
  if (!salesperson || !Number.isSafeInteger(count) || count < 1) throw new Error('Usage: assign-more-existing-customers.ts "<salesperson>" <count> [--apply]');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const desk = async () => (await client.query<{ assigned_to: string; branch: string; total: number; untouched: number }>(`
      SELECT min(contact.assigned_to) AS assigned_to, min(contact.branch) AS branch, count(*)::int AS total,
             count(*) FILTER (WHERE contact.claimed_at IS NULL AND NOT EXISTS (
               SELECT 1 FROM marketing_calls call WHERE call.lead_id = 'existing-customer:' || contact.id::text
             ))::int AS untouched
      FROM marketing_call_list_contacts contact
      WHERE contact.list_key = $1 AND lower(contact.assigned_to) = lower($2)
    `, [EXHIBITION_LIST_KEY, salesperson])).rows[0];

    const before = await desk();
    if (!before.total) throw new Error(`${salesperson} has no customers on the list yet; check the spelling.`);
    // Keep the exact spelling the salesperson already has, since their desk matches on it.
    const name = before.assigned_to;
    const store = (await client.query<{ branch: string }>(`
      SELECT branch FROM marketing_call_list_contacts
      WHERE list_key = $1 AND assigned_to = $2 GROUP BY branch ORDER BY count(*) DESC LIMIT 1
    `, [EXHIBITION_LIST_KEY, name])).rows[0]?.branch ?? '';

    const unassigned = await client.query<{ branch: string; customers: number }>(`
      SELECT branch, count(*)::int AS customers FROM marketing_call_list_contacts
      WHERE list_key = $1 AND assigned_to IS NULL GROUP BY branch ORDER BY customers DESC
    `, [EXHIBITION_LIST_KEY]);

    const assigned = await client.query<{ branch: string }>(`
      WITH picked AS (
        SELECT id FROM marketing_call_list_contacts
        WHERE list_key = $1 AND assigned_to IS NULL
        ORDER BY (upper(trim(branch)) = upper(trim($3))) DESC, id
        FOR UPDATE SKIP LOCKED
        LIMIT $4
      )
      UPDATE marketing_call_list_contacts contact
      SET assigned_to = $2, assigned_at = now(), updated_at = now()
      FROM picked WHERE contact.id = picked.id
      RETURNING contact.branch
    `, [EXHIBITION_LIST_KEY, name, store, count]);

    const byBranch: Record<string, number> = {};
    for (const row of assigned.rows) byBranch[row.branch || '(none)'] = (byBranch[row.branch || '(none)'] ?? 0) + 1;
    const after = await desk();
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');

    console.log(JSON.stringify({
      mode: apply ? 'applied' : 'dry run (nothing saved; add --apply)',
      salesperson: name,
      store,
      unassignedBefore: unassigned.rows,
      newlyAssigned: assigned.rowCount,
      ...(assigned.rowCount! < count ? { note: `Only ${assigned.rowCount} unassigned customers were left, not ${count}.` } : {}),
      newlyAssignedByBranch: byBranch,
      before: { total: before.total, untouched: before.untouched },
      after: { total: after.total, untouched: after.untouched },
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
