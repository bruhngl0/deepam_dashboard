import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { isIntegrationAuthorized } from '@/lib/integration/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAMES = 5000;
const resultRows = (result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { name: string; code: string }[];

function names(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_NAMES) return null;
  const out = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    if (trimmed) out.add(trimmed);
  }
  return [...out];
}

/**
 * CRM owns the Vendor and Category IDs. Other apps post the names they hold;
 * unknown names are registered (which assigns the next ID) and every name comes
 * back with its ID, keyed by the name exactly as it was sent (trimmed).
 */
export async function POST(request: Request) {
  if (!isIntegrationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { vendors?: unknown; categories?: unknown } | null;
  const vendorNames = names(body?.vendors);
  const categoryNames = names(body?.categories);
  if (!body || !vendorNames || !categoryNames) {
    return Response.json({ error: `Expected { vendors?: string[], categories?: string[] } with at most ${MAX_NAMES} names each` }, { status: 422 });
  }

  const vendorJson = JSON.stringify(vendorNames);
  const categoryJson = JSON.stringify(categoryNames);
  await db.execute(sql`INSERT INTO vendors (name) SELECT value FROM json_array_elements_text(${vendorJson}::json) ON CONFLICT (name) DO NOTHING`);
  await db.execute(sql`INSERT INTO categories (name) SELECT value FROM json_array_elements_text(${categoryJson}::json) ON CONFLICT (lower(name)) DO NOTHING`);
  const [vendors, categories] = await Promise.all([
    db.execute(sql`SELECT v.name, v.vendor_code AS code FROM vendors v JOIN json_array_elements_text(${vendorJson}::json) n ON n.value = v.name`),
    db.execute(sql`SELECT n.value AS name, c.category_code AS code FROM categories c JOIN json_array_elements_text(${categoryJson}::json) n ON lower(n.value) = lower(c.name)`),
  ]);
  return Response.json({
    vendors: Object.fromEntries(resultRows(vendors).map((r) => [r.name, r.code])),
    categories: Object.fromEntries(resultRows(categories).map((r) => [r.name, r.code])),
  });
}
