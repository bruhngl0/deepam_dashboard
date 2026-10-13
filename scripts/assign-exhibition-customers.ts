import '../src/db/load-env';
import pg from 'pg';
import { EXHIBITION_LIST_KEY } from '../src/lib/marketing/existing-customer-import';

const MG_ROAD_SALESPEOPLE = [
  'Krishna V N',
  'Mary Josephine',
  'Padma H',
  'Pramila N V',
  'Ranjini B',
  'Srinivas G',
  'Yasar Arafat',
  'Charita Reddy',
  'Sharanya R',
  'Abhishek Thapa',
] as const;

const JAYANAGAR_SALESPEOPLE = [
  'Anil Kumar Sharma',
  'Anuradha',
  'Kavya S',
  'M V Raju',
] as const;

const ASSIGNMENT_GROUPS = [
  { branch: 'MG Road', aliases: ['MG', 'MG ROAD'], salespeople: MG_ROAD_SALESPEOPLE },
  { branch: 'Jayanagar', aliases: ['JAYANAGAR'], salespeople: JAYANAGAR_SALESPEOPLE },
] as const;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const assignments: Record<string, Array<{ assigned_to: string; customers: number }>> = {};
    for (const group of ASSIGNMENT_GROUPS) {
      await client.query(`
        WITH eligible AS (
          SELECT id, row_number() OVER (ORDER BY id) AS position
          FROM marketing_call_list_contacts
          WHERE list_key = $1 AND upper(trim(branch)) = ANY($2::text[])
        ), salespeople AS (
          SELECT salesperson, position
          FROM unnest($3::text[]) WITH ORDINALITY AS person(salesperson, position)
        )
        UPDATE marketing_call_list_contacts AS contact
        SET assigned_to = salespeople.salesperson,
            assigned_at = now(),
            updated_at = now()
        FROM eligible
        JOIN salespeople
          ON salespeople.position = ((eligible.position - 1) % cardinality($3::text[])) + 1
        WHERE contact.id = eligible.id
      `, [EXHIBITION_LIST_KEY, group.aliases, group.salespeople]);

      const result = await client.query<{ assigned_to: string; customers: number }>(`
        SELECT assigned_to, count(*)::int AS customers
        FROM marketing_call_list_contacts
        WHERE list_key = $1 AND upper(trim(branch)) = ANY($2::text[])
        GROUP BY assigned_to
        ORDER BY min(id)
      `, [EXHIBITION_LIST_KEY, group.aliases]);
      assignments[group.branch] = result.rows;
    }

    const unassignedBranches = await client.query<{ branch: string; assigned: number; unassigned: number }>(`
      SELECT branch,
             count(*) FILTER (WHERE assigned_to IS NOT NULL)::int AS assigned,
             count(*) FILTER (WHERE assigned_to IS NULL)::int AS unassigned
      FROM marketing_call_list_contacts
      WHERE list_key = $1 AND assigned_to IS NULL
      GROUP BY branch
      ORDER BY branch
    `, [EXHIBITION_LIST_KEY]);
    await client.query('COMMIT');

    console.log(JSON.stringify({ listKey: EXHIBITION_LIST_KEY, assignments, unassignedBranches: unassignedBranches.rows }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
