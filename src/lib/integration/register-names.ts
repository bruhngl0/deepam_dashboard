import { sql } from 'drizzle-orm';
import { db } from '@/db';

const resultRows = (result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { name: string; code: string }[];

/**
 * CRM owns the Vendor and Category IDs: registers names it has not seen (which assigns the next ID)
 * and returns every name's ID, keyed by the name exactly as given. Vendors match by exact name,
 * categories ignoring case. Used by POST /api/integration/ids and by the Hemparshwa ID handover.
 */
export async function registerVendorAndCategoryNames(vendorNames: string[], categoryNames: string[]) {
  const vendorJson = JSON.stringify(vendorNames);
  const categoryJson = JSON.stringify(categoryNames);
  await db.execute(sql`INSERT INTO vendors (name) SELECT value FROM json_array_elements_text(${vendorJson}::json) ON CONFLICT (name) DO NOTHING`);
  await db.execute(sql`INSERT INTO categories (name) SELECT value FROM json_array_elements_text(${categoryJson}::json) ON CONFLICT (lower(name)) DO NOTHING`);
  const [vendors, categories] = await Promise.all([
    db.execute(sql`SELECT v.name, v.vendor_code AS code FROM vendors v JOIN json_array_elements_text(${vendorJson}::json) n ON n.value = v.name`),
    db.execute(sql`SELECT n.value AS name, c.category_code AS code FROM categories c JOIN json_array_elements_text(${categoryJson}::json) n ON lower(n.value) = lower(c.name)`),
  ]);
  return {
    vendors: Object.fromEntries(resultRows(vendors).map((r) => [r.name, r.code])) as Record<string, string>,
    categories: Object.fromEntries(resultRows(categories).map((r) => [r.name, r.code])) as Record<string, string>,
  };
}
