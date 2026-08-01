/**
 * Database clients.
 *
 * Two drivers, deliberately (D-75):
 *
 *   `db`     HTTP driver — one round trip per query, no connection pool to
 *            exhaust under serverless concurrency. Use for all reads.
 *
 *   `txDb()` WebSocket driver — the HTTP driver cannot run multi-statement
 *            transactions, and the import commit path must be all-or-nothing
 *            (D-60). Use only there, and always close the pool afterwards.
 */

import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePool } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// Node has no global WebSocket before v22, and the pooled driver needs one.
// Harmless on runtimes that provide it.
if (typeof globalThis.WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.',
  );
}

/** Read path. Safe to import from Server Components. */
export const db = drizzle(neon(connectionString), { schema });

/**
 * Write path for transactional imports. Caller owns the pool lifecycle:
 *
 *   const { db: tx, pool } = txDb();
 *   try { await tx.transaction(async (t) => { ... }); }
 *   finally { await pool.end(); }
 */
export function txDb() {
  const pool = new Pool({ connectionString });
  return { db: drizzlePool(pool, { schema }), pool };
}

export { schema };
