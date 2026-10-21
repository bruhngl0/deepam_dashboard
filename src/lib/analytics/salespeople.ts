/**
 * Salesperson IDs (EMP-0001) and how each app's name or code for a person maps to one.
 * The roster and matches live in the analytics database (dim_salesperson, salesperson_alias) and are
 * never rebuilt: refresh() only adds new WalkTrack salespeople and auto-matches names that belong to
 * exactly one person. Manual matches made here are never changed by a refresh.
 */

import { aq, analyticsPool } from './db';

export type AliasSource = 'walktrack' | 'pos' | 'crm_calls' | 'rc';
export const SOURCE_LABEL: Record<AliasSource, string> = {
  walktrack: 'WalkTrack salesperson',
  pos: 'Bill salesperson (billing)',
  crm_calls: 'Marketing caller (CRM)',
  rc: 'RC Dashboard visit salesperson',
};

export type Salesperson = { emp_code: string; name: string; store_code: string | null; names: number };
export type Alias = { source: AliasSource; key: string; display: string; emp_code: string | null; matched_by: 'auto' | 'manual' | null; seen_count: number };

export async function salespersonRoster(): Promise<Salesperson[] | null> {
  return aq<Salesperson>(`
    SELECT s.emp_code, s.name, s.store_code, count(a.key)::int AS names
    FROM analytics.dim_salesperson s LEFT JOIN analytics.salesperson_alias a USING (emp_code)
    GROUP BY 1, 2, 3 ORDER BY s.store_code NULLS LAST, s.name`);
}

export async function salespersonAliases(): Promise<Alias[] | null> {
  return aq<Alias>(`
    SELECT source, key, display, emp_code, matched_by, seen_count FROM analytics.salesperson_alias
    ORDER BY emp_code IS NOT NULL, source, seen_count DESC, display`);
}

const SOURCES = Object.keys(SOURCE_LABEL) as AliasSource[];
const isSource = (v: unknown): v is AliasSource => SOURCES.includes(v as AliasSource);

/** Matches a name to a salesperson, or with emp = null marks it "not matched" by hand, so no refresh matches it by name again. False for bad input. */
export async function matchAlias(source: unknown, key: unknown, emp: unknown): Promise<boolean> {
  if (!isSource(source) || typeof key !== 'string' || !key) return false;
  if (emp !== null && (typeof emp !== 'string' || !/^EMP-\d{4}$/.test(emp))) return false;
  const rows = await aq(`
    UPDATE analytics.salesperson_alias SET emp_code = $3, matched_by = 'manual', updated_at = now()
    WHERE source = $1 AND key = $2 AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM analytics.dim_salesperson WHERE emp_code = $3))
    RETURNING 1`, [source, key, emp]);
  return Boolean(rows?.length);
}

/** Adds a salesperson and, when given, matches a name to them in the same step. */
export async function addSalesperson(name: unknown, store: unknown, match?: { source: unknown; key: unknown }): Promise<string | null> {
  const pool = analyticsPool();
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!pool || !clean || clean.length > 120) return null;
  const storeCode = typeof store === 'string' && /^STR-\d{3}$/.test(store) ? store : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ emp_code: string }>(
      'INSERT INTO analytics.dim_salesperson (name, store_code) VALUES ($1, $2) RETURNING emp_code', [clean, storeCode]);
    const emp = rows[0].emp_code;
    if (match && isSource(match.source) && typeof match.key === 'string' && match.key) {
      await client.query(`UPDATE analytics.salesperson_alias SET emp_code = $3, matched_by = 'manual', updated_at = now() WHERE source = $1 AND key = $2`,
        [match.source, match.key, emp]);
    }
    await client.query('COMMIT');
    return emp;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
