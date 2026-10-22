// Moves untouched existing customers to one salesperson, and optionally puts
// every unclaimed lead in their queue.
//
//   npx tsx scripts/hand-over-to-salesperson.ts "Abhishek Thapa" 300 --from "unassigned,Anuradha,Kavya S"          # dry run
//   npx tsx scripts/hand-over-to-salesperson.ts "Abhishek Thapa" 100 --from "Anil Kumar Sharma" --leads --apply
//
// Existing customers: "unassigned" in --from means exhibition-list customers
// nobody holds; those go first. The rest come from the named salespeople,
// always from whoever has the most untouched customers left, so they end up
// even. Only customers not yet claimed or called move, lowest list order
// first, and they arrive unclaimed, so the receiver claims them as usual.
// Leads (--leads): the same ones the Claim button hands out (shown in
// Marketing Intelligence, nobody's, no call, not closed, not bought), but with
// no routing, so BLVD Club, Virtual calls and Chennai leads are included.
import '../src/db/load-env';
import pg from 'pg';
import { nowLocal } from '../src/lib/marketing/local';
import { LEADS_FROM } from '../src/lib/marketing/store';
import { VIRTUAL_CALLS_GROUP, EXHB_TAG } from '../src/lib/marketing/sheet-routing';
import { CALL_LIST_KEYS, EXHIBITION_LIST_KEY } from '../src/lib/marketing/existing-customer-import';

const UNASSIGNED = 'unassigned';
const untouched = `contact.claimed_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM marketing_calls call WHERE call.lead_id = 'existing-customer:' || contact.id::text)`;

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const fromArg = option('--from') ?? '';
  const [to, countArg] = process.argv.slice(2).filter(arg => !arg.startsWith('--') && arg !== fromArg);
  const apply = process.argv.includes('--apply');
  const giveLeads = process.argv.includes('--leads');
  const count = Number(countArg);
  const givers = fromArg.split(',').map(name => name.trim()).filter(Boolean);
  if (!to || !Number.isSafeInteger(count) || count < 0 || (count && !givers.length)) {
    throw new Error('Usage: hand-over-to-salesperson.ts "<to>" <count> --from "unassigned,<name>,..." [--leads] [--apply]');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const desks = async () => Object.fromEntries((await client.query<{ who: string; total: number; untouched: number }>(`
      SELECT COALESCE(contact.assigned_to, '${UNASSIGNED}') AS who, count(*)::int AS total,
             count(*) FILTER (WHERE ${untouched})::int AS untouched
      FROM marketing_call_list_contacts contact
      WHERE (contact.list_key = ANY($1) AND contact.assigned_to = ANY($2))
         OR (contact.list_key = $3 AND contact.assigned_to IS NULL AND $4)
      GROUP BY 1`, [CALL_LIST_KEYS, [to, ...givers], EXHIBITION_LIST_KEY, givers.includes(UNASSIGNED)]))
      .rows.map(row => [row.who, { total: row.total, untouched: row.untouched }]));
    const queue = async () => Number((await client.query(`
      SELECT count(*) AS n FROM marketing_leads WHERE doc->>'claimedBy' = $1`, [to])).rows[0].n);

    const before = await desks();
    const beforeLeads = await queue();
    const missing = givers.filter(name => !before[name]);
    if (missing.length) throw new Error(`No customers found for ${missing.join(', ')}; check the spelling.`);

    // Unassigned first, then always from the giver with the most untouched left.
    const left = Object.fromEntries(givers.map(name => [name, before[name].untouched]));
    const take: Record<string, number> = Object.fromEntries(givers.map(name => [name, 0]));
    let wanted = count;
    if (givers.includes(UNASSIGNED)) {
      take[UNASSIGNED] = Math.min(wanted, left[UNASSIGNED]);
      wanted -= take[UNASSIGNED];
    }
    const people = givers.filter(name => name !== UNASSIGNED);
    while (wanted > 0 && people.length) {
      const richest = people.reduce((a, b) => (left[b] - take[b] > left[a] - take[a] ? b : a));
      if (left[richest] - take[richest] <= 0) break;
      take[richest]++;
      wanted--;
    }

    const moved: Record<string, number> = {};
    for (const giver of givers) {
      if (!take[giver]) continue;
      const result = await client.query(`
        WITH picked AS (
          SELECT contact.id FROM marketing_call_list_contacts contact
          WHERE ${giver === UNASSIGNED ? 'contact.list_key = $3 AND contact.assigned_to IS NULL' : 'contact.list_key = ANY($3) AND contact.assigned_to = $4'}
            AND ${untouched}
          ORDER BY contact.id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        )
        UPDATE marketing_call_list_contacts contact
        SET assigned_to = $1, assigned_at = now(), updated_at = now()
        FROM picked WHERE contact.id = picked.id`,
        giver === UNASSIGNED ? [to, take[giver], EXHIBITION_LIST_KEY] : [to, take[giver], CALL_LIST_KEYS, giver]);
      moved[giver] = result.rowCount ?? 0;
    }

    const leadsByGroup: Record<string, number> = {};
    if (giveLeads) {
      const leads = await client.query<{ group: string }>(`
        WITH candidates AS (
          SELECT ml.id FROM marketing_leads ml
          WHERE COALESCE(ml.doc->>'claimedBy', '') = ''
            AND (ml.doc->>'date' >= $3 OR ml.doc->>'claimGroup' = $4 OR jsonb_exists(ml.doc->'tags', $5))
            AND COALESCE(ml.doc->>'status', 'New') NOT IN ('Connected / not interested', 'Wrong number')
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(ml.doc->'interactions', '[]'::jsonb)) interaction
              WHERE interaction->>'type' = 'call')
            AND NOT EXISTS (SELECT 1 FROM marketing_sales ms WHERE ms.phone = ml.phone)
          FOR UPDATE SKIP LOCKED
        )
        UPDATE marketing_leads ml
        SET doc = jsonb_set(jsonb_set(ml.doc, '{claimedBy}', to_jsonb($1::text), true), '{claimedAt}', to_jsonb($2::text), true),
            version = ml.version + 1, updated_at = now()
        FROM candidates WHERE ml.id = candidates.id
        RETURNING COALESCE(ml.doc->>'claimGroup', '') AS group`,
        [to, nowLocal(), LEADS_FROM, VIRTUAL_CALLS_GROUP, EXHB_TAG]);
      for (const row of leads.rows) leadsByGroup[row.group || '(general)'] = (leadsByGroup[row.group || '(general)'] ?? 0) + 1;
    }

    const after = await desks();
    const afterLeads = await queue();
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    const movedTotal = Object.values(moved).reduce((a, b) => a + b, 0);
    console.log(JSON.stringify({
      mode: apply ? 'applied' : 'dry run (nothing saved; add --apply)',
      existingCustomersMoved: movedTotal, movedFrom: moved,
      ...(movedTotal < count ? { note: `Only ${movedTotal} untouched customers were available, not ${count}.` } : {}),
      ...(giveLeads ? { leadsGiven: afterLeads - beforeLeads, leadsByGroup } : {}),
      untouchedBefore: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.untouched])),
      untouchedAfter: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.untouched])),
      [`${to} leads`]: { before: beforeLeads, after: afterLeads },
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
