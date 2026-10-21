/**
 * The analytics database (migration/analytics in the workspace): one copy of every Deepam app's data,
 * rebuilt every few minutes, with each KPI defined once. CRM reads its reports from it and triggers
 * its refresh. Only used where ANALYTICS_DATABASE_URL is set; without it, reports fall back to CRM's
 * own tables and live calls, so nothing depends on it being there.
 */

import { Pool } from 'pg';

const holder = globalThis as unknown as { analyticsPool?: Pool | null };

export function analyticsPool(): Pool | null {
  if (holder.analyticsPool !== undefined) return holder.analyticsPool;
  const url = process.env.ANALYTICS_DATABASE_URL;
  holder.analyticsPool = url ? new Pool({ connectionString: url, max: 4 }) : null;
  holder.analyticsPool?.on('error', (error) => console.error('[analytics pool]', error.message));
  return holder.analyticsPool;
}

export const analyticsConfigured = () => analyticsPool() !== null;

/** Runs a read on the analytics database; null when it is not configured. */
export async function aq<T extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[] | null> {
  const pool = analyticsPool();
  if (!pool) return null;
  return (await pool.query<T>(text, values)).rows;
}

/** When the data was last rebuilt, for the "Data as of" line on every report. */
export async function analyticsAsOf(): Promise<string | null> {
  const rows = await aq<{ ran_at: Date }>('SELECT ran_at FROM analytics.refresh_log WHERE error IS NULL ORDER BY ran_at DESC LIMIT 1');
  return rows?.[0]?.ran_at ? new Date(rows[0].ran_at).toISOString() : null;
}
