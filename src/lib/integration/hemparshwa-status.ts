/** What CRM currently holds from Hemparshwa OS, for the Import page. */

import { sql } from 'drizzle-orm';
import { db } from '@/db';

export interface HemparshwaCopy {
  configured: boolean;
  imports: { importId: number; dataType: string; fileName: string; rows: number; importedAt: string; syncedAt: string }[];
  bills: number;
  netSales: number;
  /** Customer Master rows held from Hemparshwa. */
  masterCustomers: number;
}

export async function getHemparshwaCopy(): Promise<HemparshwaCopy> {
  const imports = await db.execute(sql`
    SELECT import_id, data_type, file_name, rows_synced, imported_at, synced_at FROM hemparshwa_imports ORDER BY import_id DESC`);
  const totals = await db.execute(sql`
    SELECT COUNT(*)::int AS bills, COALESCE(SUM(s.bill_amount), 0) AS net
    FROM sales s JOIN hemparshwa_imports i ON i.batch_id = s.batch_id`);
  const total = totals.rows[0] as { bills: number; net: string | number };
  const master = await db.execute(sql`SELECT COUNT(*)::int AS n FROM hemparshwa_customers`);
  return {
    configured: Boolean(process.env.HEMPARSHWA_URL && process.env.HEMPARSHWA_INTEGRATION_TOKEN),
    imports: (imports.rows as Record<string, unknown>[]).map((r) => ({
      importId: Number(r.import_id),
      dataType: String(r.data_type),
      fileName: String(r.file_name),
      rows: Number(r.rows_synced),
      importedAt: new Date(r.imported_at as string).toISOString(),
      syncedAt: new Date(r.synced_at as string).toISOString(),
    })),
    bills: Number(total.bills),
    netSales: Number(total.net),
    masterCustomers: Number((master.rows[0] as { n: number }).n),
  };
}
