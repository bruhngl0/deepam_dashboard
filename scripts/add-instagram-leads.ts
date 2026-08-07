/**
 * Additive Instagram/Meta update — for when a new export only has fresh
 * numbers on the Meta side and no WhatsApp/Google/Others sheets to go with it.
 *
 * Thin CLI wrapper around `lib/import/instagram-leads.ts`, which is also what
 * the `/import` page's "Instagram / Meta leads" uploader calls — one
 * implementation, two front ends, same reasoning as `master-sheet.ts` (D-76):
 * a script and a browser upload duplicating this logic would be exactly the
 * two-definitions-that-can-disagree bug that pattern exists to prevent.
 *
 *   npx tsx scripts/add-instagram-leads.ts "<file.xlsx>"           # preview
 *   npx tsx scripts/add-instagram-leads.ts "<file.xlsx>" --commit  # write
 */

import '../src/db/load-env';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  previewInstagramLeadsImport,
  commitInstagramLeadsImport,
} from '../src/lib/import/instagram-leads';

const commit = process.argv.includes('--commit');

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: npx tsx scripts/add-instagram-leads.ts "<file.xlsx>" [--commit]');
    process.exit(1);
  }

  const buffer = readFileSync(path);
  const fileName = basename(path);

  const preview = await previewInstagramLeadsImport(buffer, fileName);

  for (const s of preview.sheets) {
    console.log(`\n  "${s.sheet}"  →  Master Sheet — Meta`);
    console.log(
      `    rows ${String(s.dataRows).padStart(5)}   valid ${String(s.valid).padStart(5)}` +
        `   unique ${String(s.uniquePhones).padStart(5)}` +
        `   dupes-in-file ${String(s.duplicatesInFile).padStart(5)}` +
        `   rejected ${String(s.rejected).padStart(3)}`,
    );
    console.log(
      `    new customers ${String(s.newCustomers).padStart(5)}` +
        `   already known ${String(s.existingCustomers).padStart(5)}`,
    );
    if (s.rejectedByCode.length > 0) {
      console.log(`    rejects: ${s.rejectedByCode.map((r) => `${r.code}=${r.n}`).join('  ')}`);
    }
    if (s.alreadyImported) {
      console.log('    ⚠ this exact sheet has been committed before — re-import is a no-op');
    }
  }

  console.log(`\n  distinct people across all sheets: ${preview.distinctPeople}`);

  if (!commit) {
    console.log('\n  Preview only. Re-run with --commit to write.\n');
    return;
  }

  const result = await commitInstagramLeadsImport(preview, 'cli');
  console.log(
    `\n  ✓ committed — ${result.sheetsCommitted} sheets, ${result.touchesInserted} new ` +
      `Instagram/Meta lead touches (${result.touchesSkipped} already there), ` +
      `${result.customersUpserted} customers upserted, lifecycle recomputed\n`,
  );
}

main().catch((e) => {
  console.error('\nImport failed:', e.message);
  process.exit(1);
});
