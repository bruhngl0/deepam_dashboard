import '../src/db/load-env';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { normalizePhone } from '../src/lib/phone';
import { ONLINE_LIST_KEY, ONLINE_LIST_NAME } from '../src/lib/marketing/existing-customer-import';

/**
 * Adds Shopify (online) customers to the CRM as Online customers.
 *
 * Anyone whose phone is already a CRM customer, or already on a calling list,
 * is left exactly as they are. Everyone else becomes a customer record with
 * Online (STR-003) as preferred store and joins the Online customers calling
 * list. Paid buyers also get a loyalty row carrying their Shopify order count
 * and sales, which is the evidence lifecycle recompute uses to mark them
 * existing (D-38).
 *
 *   npx tsx scripts/import-shopify-customers.ts shopify_customers.json            # dry run
 *   npx tsx scripts/import-shopify-customers.ts shopify_customers.json --commit
 *
 * The JSON is one object per person, built from the Shopify customer/order
 * exports: { row, name, phones[], email, address, city, state, pincode,
 * country, status, paidOrders, paidSales, firstOrder, lastPaidOrder, shopifyIds }.
 */

type ShopifyCustomer = {
  row: number; name: string; phones: string[]; email: string | null; address: string; city: string; state: string;
  pincode: string; country: string; status: string; paidOrders: number; paidSales: number;
  firstOrder: string | null; lastPaidOrder: string | null; shopifyIds: string;
};

const CHUNK = 500;

async function main() {
  const source = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!source) throw new Error('Usage: npx tsx scripts/import-shopify-customers.ts customers.json [--commit]');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const people = JSON.parse(await fs.readFile(source, 'utf8')) as ShopifyCustomer[];

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const known = new Set<string>((await client.query(`
      SELECT phone_e164 AS phone FROM customers
      UNION SELECT phone FROM marketing_call_list_contacts`)).rows.map(row => row.phone));

    const report = { inFile: people.length, noIndianPhone: 0, alreadyInCrm: 0, repeatedInFile: 0, toAdd: 0, paidToAdd: 0 };
    const additions: (ShopifyCustomer & { e164: string; national: string })[] = [];
    const taken = new Set<string>();
    for (const person of people) {
      const phones = person.phones.map(normalizePhone).flatMap(p => (p.ok ? [p] : []));
      if (!phones.length) { report.noIndianPhone++; continue; }
      if (phones.some(p => known.has(p.e164))) { report.alreadyInCrm++; continue; }
      if (taken.has(phones[0].e164)) { report.repeatedInFile++; continue; }
      taken.add(phones[0].e164);
      additions.push({ ...person, e164: phones[0].e164, national: phones[0].national });
    }
    report.toAdd = additions.length;
    report.paidToAdd = additions.filter(p => p.paidOrders > 0).length;
    if (!commit || !additions.length) { console.log(JSON.stringify({ dryRun: !commit, ...report })); return; }

    await client.query('BEGIN');
    const online = (await client.query(`SELECT id FROM stores WHERE store_code = 'STR-003'`)).rows[0];
    if (!online) throw new Error('Online store (STR-003) not found.');
    const batch = (await client.query(`
      INSERT INTO import_batches (source_type, source_kind, file_name, status, rows_total, rows_ok, rows_duplicate, uploaded_by, committed_at)
      VALUES ('existing', 'existing_customer', $1, 'committed', $2, $3, $4, 'shopify-import', now()) RETURNING id`,
      [path.basename(source), people.length, additions.length, report.alreadyInCrm + report.repeatedInFile])).rows[0].id as string;

    const idByPhone = new Map<string, { id: number; code: string }>();
    for (let start = 0; start < additions.length; start += CHUNK) {
      const part = additions.slice(start, start + CHUNK);
      const values: unknown[] = [];
      const tuples = part.map((p, i) => {
        const first = p.firstOrder ?? p.lastPaidOrder;
        const last = p.lastPaidOrder ?? p.firstOrder;
        values.push(p.e164, p.national, p.name || null, p.email, p.city || null, online.id,
          first ? `${first}T00:00:00Z` : new Date().toISOString(), last ? `${last}T00:00:00Z` : new Date().toISOString());
        const o = i * 8;
        return `($${o + 1},$${o + 2},$${o + 3},'shopify',$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`;
      });
      // ON CONFLICT DO NOTHING: a customer created since the check above stays untouched.
      const written = await client.query(`
        INSERT INTO customers (phone_e164, phone_national, full_name, name_source, email, city, preferred_store_id, first_seen_at, last_seen_at)
        VALUES ${tuples.join(',')}
        ON CONFLICT (phone_e164) DO NOTHING
        RETURNING id`, values);
      // customer_code is set by an AFTER INSERT trigger (drizzle/0017), so RETURNING cannot see it.
      const ids = written.rows.map(row => Number(row.id));
      const codes = await client.query(`SELECT id, phone_e164, customer_code FROM customers WHERE id = ANY($1::bigint[])`, [ids]);
      for (const row of codes.rows) idByPhone.set(row.phone_e164, { id: Number(row.id), code: row.customer_code });
    }
    const inserted = additions.filter(p => idByPhone.has(p.e164));

    const buyers = inserted.filter(p => p.paidOrders > 0);
    for (let start = 0; start < buyers.length; start += CHUNK) {
      const part = buyers.slice(start, start + CHUNK);
      const values: unknown[] = [];
      const tuples = part.map((p, i) => {
        values.push(idByPhone.get(p.e164)!.id, batch, p.shopifyIds || null, p.paidOrders, p.paidSales.toFixed(2), p.firstOrder, p.lastPaidOrder,
          JSON.stringify({ source: 'shopify', row: p.row, status: p.status, address: p.address, state: p.state, pincode: p.pincode, country: p.country }));
        const o = i * 8;
        return `($${o + 1},$${o + 2},$${o + 3},'shopify_online','Online (Shopify)',$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`;
      });
      await client.query(`
        INSERT INTO loyalty_customers (customer_id, batch_id, external_user_id, loyalty_type, registered_store_name, total_bill_count, total_bill_amount, first_bill_date, last_bill_date, raw)
        VALUES ${tuples.join(',')}
        ON CONFLICT (customer_id) DO NOTHING`, values);
    }

    for (let start = 0; start < inserted.length; start += CHUNK) {
      const part = inserted.slice(start, start + CHUNK);
      const values: unknown[] = [];
      const tuples = part.map((p, i) => {
        values.push(ONLINE_LIST_KEY, ONLINE_LIST_NAME, idByPhone.get(p.e164)!.code, p.name || p.e164, p.e164, 'Online', p.city, path.basename(source), p.row);
        const o = i * 9;
        return `(${Array.from({ length: 9 }, (_, k) => `$${o + k + 1}`).join(',')})`;
      });
      await client.query(`
        INSERT INTO marketing_call_list_contacts (list_key, list_name, source_customer_id, name, phone, branch, city, source_file, source_row)
        VALUES ${tuples.join(',')}
        ON CONFLICT (list_key, phone) DO NOTHING`, values);
    }

    await client.query('SELECT recompute_customer_lifecycle()');
    await client.query('COMMIT');
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution');
    console.log(JSON.stringify({ committed: true, batchId: batch, ...report, customersInserted: inserted.length, loyaltyRows: buyers.length }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
