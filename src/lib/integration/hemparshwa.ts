/**
 * Hemparshwa OS → CRM. Hemparshwa is where source files are imported; CRM keeps
 * a copy of the imported rows and pulls it here. Hemparshwa's live service has
 * no outbound internet, so CRM is always the caller.
 *
 * The feed lists every import whose rows are in Hemparshwa, each with a version
 * that changes when its rows do. One run makes the copy match the list: imports
 * that left the list (an import data reset) are removed, new or changed ones are
 * fetched whole and replaced in one transaction each. Running it twice changes
 * nothing.
 */

import { sql } from 'drizzle-orm';

export interface FeedImport {
  import_id: number;
  source: string;
  data_type: string;
  file_name: string;
  file_sha256: string;
  rows_imported: number;
  imported_at: string;
  period_from: string | null;
  period_to: string | null;
  version: string;
}

export interface SyncPlan {
  remove: number[];
  fetch: FeedImport[];
}

/** Which copied imports to drop and which feed imports to (re)fetch. Only sales rows are served so far. */
export function planSync(feed: FeedImport[], copied: { importId: number; version: string }[]): SyncPlan {
  const wanted = feed.filter((i) => i.data_type === 'sales');
  const have = new Map(copied.map((c) => [c.importId, c.version]));
  const listed = new Set(wanted.map((i) => i.import_id));
  return {
    remove: copied.filter((c) => !listed.has(c.importId)).map((c) => c.importId),
    fetch: wanted.filter((i) => have.get(i.import_id) !== i.version),
  };
}

export interface SyncResult {
  removed: number[];
  synced: { importId: number; rows: number }[];
  unchanged: number;
}

function feedConfig() {
  const base = process.env.HEMPARSHWA_URL?.replace(/\/+$/, '');
  const token = process.env.HEMPARSHWA_INTEGRATION_TOKEN;
  if (!base || !token) throw new Error('HEMPARSHWA_URL and HEMPARSHWA_INTEGRATION_TOKEN are not set.');
  return { base, token };
}

async function feed<T>(path: string): Promise<T> {
  const { base, token } = feedConfig();
  const res = await fetch(`${base}/api/integration/imports${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Hemparshwa feed ${path || '/'} answered ${res.status}`);
  return (await res.json()) as T;
}

async function fetchRows(importId: number): Promise<Record<string, unknown>[][]> {
  const pages: Record<string, unknown>[][] = [];
  let after: string | null = null;
  do {
    const page: { rows: Record<string, unknown>[]; next: string | null } = await feed(
      `/${importId}/rows${after ? `?after=${encodeURIComponent(after)}` : ''}`,
    );
    pages.push(page.rows);
    after = page.next;
  } while (after);
  return pages;
}

export async function syncHemparshwa(): Promise<SyncResult> {
  const { imports } = await feed<{ imports: FeedImport[] }>('');
  // Loaded here so planSync stays importable without a database (its unit test).
  const { txDb } = await import('@/db');
  const { db, pool } = txDb();
  try {
    const copied = (await db.execute(sql`SELECT import_id AS "importId", version FROM hemparshwa_imports`))
      .rows as { importId: number; version: string }[];
    const plan = planSync(imports, copied);

    if (plan.remove.length > 0) {
      const ids = JSON.stringify(plan.remove);
      await db.execute(sql`
        DELETE FROM hemparshwa_imports
        WHERE import_id IN (SELECT value::int FROM json_array_elements_text(${ids}::json))
      `);
    }

    const synced: SyncResult['synced'] = [];
    for (const imp of plan.fetch) {
      // Fetched whole before anything is written, so a feed failure leaves the old copy intact.
      const pages = await fetchRows(imp.import_id);
      const rows = pages.reduce((n, p) => n + p.length, 0);
      await db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM hemparshwa_imports WHERE import_id = ${imp.import_id}`);
        await tx.execute(sql`
          INSERT INTO hemparshwa_imports
            (import_id, source, data_type, file_name, file_sha256, rows_imported, imported_at, period_from, period_to, version, rows_synced)
          VALUES (${imp.import_id}, ${imp.source}, ${imp.data_type}, ${imp.file_name}, ${imp.file_sha256}, ${imp.rows_imported},
            ${imp.imported_at}::timestamptz, ${imp.period_from}::date, ${imp.period_to}::date, ${imp.version}, ${rows})
        `);
        for (const page of pages) {
          if (page.length === 0) continue;
          // One JSON parameter per page: a row-per-parameter insert would pass Postgres's 65535 limit. (D-62)
          await tx.execute(sql`
            INSERT INTO hemparshwa_sales_lines
              (import_id, store_id, store_name, invoice_id, invoice_date, sales_type, invoice_line_id, sku_code, sku_name,
               category_id, category, subcategory, vendor_id, vendor, customer_id, customer_name, customer_phone,
               salesperson, quantity, selling_price, discount, net_amount, cogs, details)
            SELECT ${imp.import_id}, x.store_id, x.store_name, x.invoice_id, x.invoice_date, COALESCE(x.sales_type, ''), x.invoice_line_id, x.sku_code, x.sku_name,
               x.category_id, x.category, x.subcategory, x.vendor_id, x.vendor, x.customer_id, x.customer_name, x.customer_phone,
               x.salesperson, x.quantity, x.selling_price, x.discount, x.net_amount, x.cogs, COALESCE(x.details, '{}'::jsonb)
            FROM jsonb_to_recordset(${JSON.stringify(page)}::jsonb) AS x(
               store_id text, store_name text, invoice_id text, invoice_date date, sales_type text, invoice_line_id text, sku_code text, sku_name text,
               category_id text, category text, subcategory text, vendor_id text, vendor text, customer_id text, customer_name text,
               customer_phone text, salesperson text, quantity numeric, selling_price numeric, discount numeric, net_amount numeric,
               cogs numeric, details jsonb)
            ON CONFLICT (store_id, invoice_id, invoice_date, sales_type, invoice_line_id) DO UPDATE SET
               import_id = excluded.import_id, store_name = excluded.store_name,
               sku_code = excluded.sku_code, sku_name = excluded.sku_name, category_id = excluded.category_id,
               category = excluded.category, subcategory = excluded.subcategory, vendor_id = excluded.vendor_id,
               vendor = excluded.vendor, customer_id = excluded.customer_id, customer_name = excluded.customer_name,
               customer_phone = excluded.customer_phone, salesperson = excluded.salesperson, quantity = excluded.quantity,
               selling_price = excluded.selling_price, discount = excluded.discount, net_amount = excluded.net_amount,
               cogs = excluded.cogs, details = excluded.details
          `);
        }
      });
      synced.push({ importId: imp.import_id, rows });
    }
    return { removed: plan.remove, synced, unchanged: imports.filter((i) => i.data_type === 'sales').length - plan.fetch.length };
  } finally {
    await pool.end();
  }
}
