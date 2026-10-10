/**
 * Database client.
 *
 * One node-postgres pool per process, shared by reads and transactions
 * (D-75). Production is AWS RDS; any PostgreSQL works locally. Connect with
 * `sslmode=verify-full&sslrootcert=certs/rds-global-bundle.pem` for RDS —
 * the bundle ships in the image, and the path is relative to the working
 * directory (the repo root locally, /app in the container).
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and add a PostgreSQL connection string.',
  );
}

// Dev reloads re-evaluate this module; keep one pool rather than leaking one per reload.
const globalForDb = globalThis as unknown as { dbPool?: Pool };
const pool = globalForDb.dbPool ?? new Pool({ connectionString });
if (!globalForDb.dbPool) {
  // An idle client dropped by the server must not crash the process; the pool replaces it.
  pool.on('error', (error) => console.error('[db pool]', error.message));
  globalForDb.dbPool = pool;
}

/** Safe to import from Server Components. */
export const db = drizzle(pool, { schema });

/**
 * Write path for transactional imports (D-60). `db.transaction()` checks out a
 * dedicated client from the shared pool, so this is the same `db`; `pool.end`
 * is kept as a no-op so callers' `finally` blocks stay correct without closing
 * the pool everyone else is using.
 *
 *   const { db: tx, pool } = txDb();
 *   try { await tx.transaction(async (t) => { ... }); }
 *   finally { await pool.end(); }
 */
export function txDb() {
  return { db, pool: { end: async () => {} } };
}

export { schema };
