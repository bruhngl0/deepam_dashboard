/**
 * Internal accounts (drizzle/0032): their bills stay off any customer, and they are kept out of marketing
 * conversions and calling lists. Runs against the database in .env.local (skipped without one), inside a
 * transaction that is rolled back.
 */

import { describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { Client } from 'pg';

const url = process.env.DATABASE_URL || config({ path: '.env.local' }).parsed?.DATABASE_URL;

describe.skipIf(!url)('internal accounts', () => {
  it('keeps their bills off the customer and skips them in marketing', async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('BEGIN');
      const { rows: [table] } = await client.query(`SELECT to_regclass('internal_accounts') AS name`);
      if (!table.name) return; // a database not yet migrated to 0032
      const { rows: [bill] } = await client.query(
        `SELECT s.id, c.phone_e164 FROM sales s JOIN customers c ON c.id = s.customer_id ORDER BY s.id LIMIT 1`);
      if (!bill) return;
      await client.query(`INSERT INTO internal_accounts (phone_e164, label) VALUES ($1, 'test') ON CONFLICT DO NOTHING`, [bill.phone_e164]);

      const relinked = await client.query(`UPDATE sales SET customer_id = customer_id WHERE id = $1 RETURNING customer_id`, [bill.id]);
      expect(relinked.rows[0].customer_id).toBeNull();

      const sale = await client.query(
        `INSERT INTO marketing_sales (invoice, phone, amount, sold_at, store) VALUES ('internal-account-test', $1, 1, '2026-11-04T10:00:00', 'MG') RETURNING invoice`,
        [bill.phone_e164]);
      expect(sale.rowCount).toBe(0);

      const contact = await client.query(
        `INSERT INTO marketing_call_list_contacts (list_key, list_name, name, phone, source_file, source_row)
         VALUES ('internal-account-test', 'test', 'test', $1, 'test', 1) RETURNING id`,
        [bill.phone_e164]);
      expect(contact.rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  }, 60_000);
});
