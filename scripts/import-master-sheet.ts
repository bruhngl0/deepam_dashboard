/**
 * Replace all lead data with the cleaned master workbook. (D-84)
 *
 *   npx tsx scripts/import-master-sheet.ts <file.xlsx>          # preview only
 *   npx tsx scripts/import-master-sheet.ts <file.xlsx> --commit # replace
 *
 * The master sheet supersedes the per-channel exports: one workbook, one sheet
 * per channel, phone numbers already reviewed. It carries four channels —
 * Meta, WhatsApp, Google Ads and Others — and the walk-in channel is gone,
 * its people redistributed across the other four by whoever prepared the file.
 *
 * ── What this deletes ───────────────────────────────────────────────────────
 * Every lead touch, follow-up, walk-in submission, campaign and lead import
 * batch. `customers` and `sales` are never touched: a customer row is the
 * identity key the sales table points at, and nothing should ever delete one
 * (§O). Orphaned customers simply stop appearing in the funnel.
 *
 * ── What that costs ─────────────────────────────────────────────────────────
 * `walkin_submissions.how_did_you_hear` is the only evidence for the
 * `self_declared` lifecycle basis. Dropping it makes 143 customers fall through
 * to `lead_matched`, so people who told us they were already customers are
 * reclassified as new acquisitions. That is a real loss of information, not a
 * cosmetic change — it inflates every conversion figure that uses the D-46
 * denominator. Back the tables up before running with --commit.
 *
 * ── What the sheet cannot tell us ───────────────────────────────────────────
 * It has no dates. Every touch is therefore stamped with the campaign start and
 * flagged `touched_at_is_estimated`, so first touch can never be resolved by
 * time — only by the channel-priority tiebreak in `customer_attribution`.
 *
 * ── This file vs the web importer ───────────────────────────────────────────
 * The parsing and the commit transaction live in `src/lib/import/master-sheet.ts`
 * and are shared with the `/import` page and its API routes (D-89) — this file
 * is now just argv handling and the console report.
 */

import { readFileSync } from 'node:fs';
import '../src/db/load-env';
import { previewMasterSheet, commitMasterSheet } from '../src/lib/import/master-sheet';

async function main() {
  const file = process.argv[2];
  const commit = process.argv.includes('--commit');

  if (!file) {
    console.error('\nUsage: npx tsx scripts/import-master-sheet.ts <file.xlsx> [--commit]\n');
    process.exit(1);
  }

  const buffer = readFileSync(file);
  const { results, distinctPeople } = previewMasterSheet(buffer);

  console.log(`\n  ${file}\n`);
  console.log('  Sheet          Rows   Valid  Distinct   Dupes  Rejected  Flagged');
  for (const r of results) {
    console.log(
      `  ${r.spec.sheet.padEnd(13)}${String(r.rawRows).padStart(5)}` +
        `${String(r.rows.length + r.duplicates).padStart(8)}` +
        `${String(r.rows.length).padStart(10)}` +
        `${String(r.duplicates).padStart(8)}` +
        `${String(r.rejected.length).padStart(10)}` +
        `${String(r.flagged).padStart(9)}`,
    );
  }

  console.log(`\n  Distinct people across all sheets: ${distinctPeople}`);

  if (!commit) {
    console.log('\n  Preview only. Re-run with --commit to replace the lead data.\n');
    return;
  }

  const summary = await commitMasterSheet(
    buffer,
    file.split('/').pop() ?? file,
    'import-master-sheet.ts',
  );

  console.log('\n  Committed.');
  console.log(`    customers upserted  ${summary.customersUpserted}`);
  console.log(`    touches inserted    ${summary.touchesInserted}`);
  console.log(`    rejects stored      ${summary.rejectsStored}\n`);
}

main().catch((e) => {
  console.error('\nFailed:', e.message, '\n');
  process.exit(1);
});
