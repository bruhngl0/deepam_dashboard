import { sql } from 'drizzle-orm';
import { db } from '@/db';

const resultRows = (result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { name: string; code: string }[];

/**
 * CRM owns the Vendor and Category IDs: registers names it has not seen (which assigns the next ID)
 * and returns every name's ID, keyed by the name exactly as given. Vendors match by exact name,
 * categories ignoring case, or through category_aliases (a short name such as "14", or an old name,
 * resolves to its Item Master item, CAT-14). Used by POST /api/integration/ids and by the Hemparshwa
 * ID handover; `registerCategories: false` only looks categories up, adding none (drizzle/0041).
 */
export async function registerVendorAndCategoryNames(vendorNames: string[], categoryNames: string[], { registerCategories = true } = {}) {
  const vendorJson = JSON.stringify(vendorNames);
  const categoryJson = JSON.stringify(categoryNames);
  await db.execute(sql`INSERT INTO vendors (name) SELECT value FROM json_array_elements_text(${vendorJson}::json) ON CONFLICT (name) DO NOTHING`);
  if (registerCategories) {
    await db.execute(sql`INSERT INTO categories (name) SELECT value FROM json_array_elements_text(${categoryJson}::json) n
      WHERE NOT EXISTS (SELECT 1 FROM category_aliases a WHERE a.alias = lower(trim(n.value))) ON CONFLICT (lower(name)) DO NOTHING`);
  }
  const [vendors, categories] = await Promise.all([
    db.execute(sql`SELECT v.name, v.vendor_code AS code FROM vendors v JOIN json_array_elements_text(${vendorJson}::json) n ON n.value = v.name`),
    db.execute(sql`SELECT n.value AS name, c.category_code AS code FROM json_array_elements_text(${categoryJson}::json) n
      LEFT JOIN category_aliases a ON a.alias = lower(trim(n.value))
      JOIN categories c ON c.id = a.category_id OR (a.category_id IS NULL AND lower(c.name) = lower(trim(n.value)))`),
  ]);
  return {
    vendors: Object.fromEntries(resultRows(vendors).map((r) => [r.name, r.code])) as Record<string, string>,
    categories: Object.fromEntries(resultRows(categories).map((r) => [r.name, r.code])) as Record<string, string>,
  };
}
