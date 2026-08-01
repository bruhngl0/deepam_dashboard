/**
 * Import a POS sales report.
 *
 *   npx tsx scripts/import-sales.ts "<path to xlsx>"           # preview only
 *   npx tsx scripts/import-sales.ts "<path to xlsx>" --commit  # preview + write
 *
 * Preview writes nothing. (D-58)
 */

import '../src/db/load-env';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { previewSalesImport, commitSalesImport } from '../src/lib/import/sales';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

async function main() {
  const path = process.argv[2];
  const commit = process.argv.includes('--commit');

  if (!path) {
    console.error('Usage: npx tsx scripts/import-sales.ts "<file.xlsx>" [--commit]');
    process.exit(1);
  }

  const buffer = readFileSync(path);
  const preview = await previewSalesImport(buffer, basename(path));
  const s = preview.summary;

  console.log(`\n  ${preview.fileName}  ·  sheet "${preview.sheetName}"`);
  if (preview.bannerText) console.log(`  ${preview.bannerText}`);
  console.log(`  sha256 ${preview.fileHash.slice(0, 16)}…`);

  console.log('\nPARSED');
  console.log(`  bills                  ${String(s.billsTotal).padStart(12)}`);
  console.log(`  gross revenue          ${inr(s.grossRevenue).padStart(12)}`);
  console.log(`  unique phones          ${String(s.uniquePhones).padStart(12)}`);
  console.log(`  bills with phone       ${String(s.withPhone).padStart(12)}`);
  console.log(
    `  bills without phone    ${String(s.withoutPhone).padStart(12)}   ${inr(s.revenueWithoutPhone)}`,
  );
  if (s.dateRange) console.log(`  date range             ${s.dateRange.from} → ${s.dateRange.to}`);

  console.log('\nBY STORE');
  for (const b of s.storeBreakdown) {
    console.log(
      `  ${b.prefix}  ${b.store.padEnd(12)} ${String(b.bills).padStart(4)} bills   ${inr(b.revenue).padStart(15)}`,
    );
  }

  if (s.unknownPrefixes.length) {
    console.log(`\n  ✗ UNMAPPED PREFIXES: ${s.unknownPrefixes.join(', ')}`);
    console.log('    Add them to stores.voucher_prefix before importing.');
  }

  if (preview.rejected.length) {
    console.log(`\nREJECTED (${preview.rejected.length})`);
    const byCode = new Map<string, number>();
    for (const r of preview.rejected)
      byCode.set(r.errorCode, (byCode.get(r.errorCode) ?? 0) + 1);
    for (const [code, n] of byCode) console.log(`  ${code.padEnd(22)} ${n}`);
    for (const r of preview.rejected.slice(0, 3)) {
      console.log(`    row ${r.rowNumber}: ${r.errorMsg}`);
    }
  }

  if (s.alreadyImported) {
    console.log('\n  ⚠ A file with this exact content has already been committed.');
    console.log('    Re-importing is harmless — voucher numbers are unique keys.');
  }

  if (!commit) {
    console.log('\n  Preview only. Re-run with --commit to write.\n');
    return;
  }

  console.log('\nCOMMITTING…');
  const result = await commitSalesImport(preview, 'cli');
  console.log(`  batch                  ${result.batchId}`);
  console.log(`  customers upserted     ${String(result.customersInserted).padStart(12)}`);
  console.log(`  sales inserted         ${String(result.salesInserted).padStart(12)}`);
  console.log(`  sales skipped (dupes)  ${String(result.salesSkipped).padStart(12)}`);
  console.log(`  rejected stored        ${String(result.rejectedStored).padStart(12)}`);
  console.log('\n  ✓ committed, lifecycle recomputed, attribution refreshed\n');
}

main().catch((e) => {
  console.error('\nImport failed:', e.message);
  process.exit(1);
});
