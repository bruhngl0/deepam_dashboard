/**
 * Prints what actually exists in the database — tables, the derived attribution
 * layer, seeded reference data and tunable settings.
 *
 *   npx tsx scripts/db-status.ts
 */

import '../src/db/load-env';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

type Row = Record<string, unknown>;

async function q(text: string): Promise<Row[]> {
  // neon-http returns a result object with `.rows`; other drivers return the
  // array directly. Accept both.
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

async function main() {
  const tables = await q(`
    SELECT c.relname AS name,
           (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_name = c.relname AND table_schema = 'public') AS cols
    FROM   pg_class c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  n.nspname = 'public' AND c.relkind = 'r'
    ORDER  BY c.relname`);

  console.log('\nTABLES');
  for (const t of tables) {
    const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM "${t.name}"`);
    console.log(
      `  ${String(t.name).padEnd(22)} ${String(t.cols).padStart(2)} cols   ${String(n).padStart(4)} rows`,
    );
  }

  const views = await q(`
    SELECT matviewname AS name FROM pg_matviews WHERE schemaname = 'public'`);
  console.log('\nMATERIALIZED VIEWS');
  for (const v of views) {
    const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM "${v.name}"`);
    console.log(`  ${String(v.name).padEnd(22)} ${String(n).padStart(4)} rows`);
  }

  const fns = await q(`
    SELECT proname AS name FROM pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public' AND proname LIKE 'recompute%'`);
  console.log('\nFUNCTIONS');
  for (const f of fns) console.log(`  ${f.name}()`);

  const exts = await q(`
    SELECT extname AS name FROM pg_extension WHERE extname IN ('pg_trgm')`);
  console.log('\nEXTENSIONS');
  for (const e of exts) console.log(`  ${e.name}`);

  const enums = await q(`
    SELECT t.typname AS name, COUNT(e.enumlabel)::int AS labels
    FROM   pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    GROUP  BY t.typname ORDER BY t.typname`);
  console.log('\nENUMS');
  for (const e of enums) console.log(`  ${String(e.name).padEnd(22)} ${e.labels} labels`);

  console.log('\nSTORES');
  for (const s of await q(`SELECT code, name, voucher_prefix FROM stores ORDER BY id`)) {
    console.log(`  ${String(s.voucher_prefix).padEnd(8)} ${s.name}`);
  }

  console.log('\nCAMPAIGNS');
  for (const c of await q(
    `SELECT name, channel, started_on FROM campaigns ORDER BY channel, name`,
  )) {
    console.log(`  ${String(c.channel).padEnd(10)} ${String(c.started_on).padEnd(12)} ${c.name}`);
  }

  console.log('\nSETTINGS (DECISIONS.md §N)');
  for (const s of await q(`SELECT key, value FROM settings ORDER BY key`)) {
    console.log(`  ${String(s.key).padEnd(30)} ${JSON.stringify(s.value)}`);
  }

  console.log('');
}

main().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});
