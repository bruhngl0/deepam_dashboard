import '../src/db/load-env';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { EXHIBITION_LIST_KEY, EXHIBITION_LIST_NAME, parseExistingCustomerCallWorkbook } from '../src/lib/marketing/existing-customer-import';

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('Usage: npx tsx scripts/import-exhibition-customers.ts /path/to/Customer.xlsx');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');

  const parsed = parseExistingCustomerCallWorkbook(await fs.readFile(source));
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    for (let start = 0; start < parsed.contacts.length; start += 500) {
      const chunk = parsed.contacts.slice(start, start + 500);
      const values: unknown[] = [];
      const tuples = chunk.map((contact, index) => {
        const offset = index * 9;
        values.push(EXHIBITION_LIST_KEY, EXHIBITION_LIST_NAME, contact.sourceCustomerId || null, contact.name, contact.phone, contact.branch, contact.city, path.basename(source), contact.sourceRow);
        return `(${Array.from({ length: 9 }, (_, i) => `$${offset + i + 1}`).join(',')})`;
      });
      const result = await client.query(`
      INSERT INTO marketing_call_list_contacts
        (list_key, list_name, source_customer_id, name, phone, branch, city, source_file, source_row)
      VALUES ${tuples.join(',')}
      ON CONFLICT (list_key, phone) DO UPDATE SET
        list_name = EXCLUDED.list_name,
        source_customer_id = EXCLUDED.source_customer_id,
        name = EXCLUDED.name,
        branch = EXCLUDED.branch,
        city = EXCLUDED.city,
        source_file = EXCLUDED.source_file,
        source_row = EXCLUDED.source_row,
        updated_at = now()
        RETURNING id`, values);
      written += result.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({
    listKey: EXHIBITION_LIST_KEY,
    listName: EXHIBITION_LIST_NAME,
    sheet: parsed.sheetName,
    imported: written,
    rejected: parsed.rejected.length,
    rejectedByReason: Object.fromEntries(parsed.rejected.reduce((map, row) => map.set(row.reason, (map.get(row.reason) ?? 0) + 1), new Map<string, number>())),
    duplicatePhones: parsed.duplicatePhones,
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
