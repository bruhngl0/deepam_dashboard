// Loads Meta ad spend from a Meta Ads Manager campaign export, replacing all saved Meta spend.
// This is the only source of Meta spend; Google spend comes from the sheets' Campaign Summary tabs.
//
//   npx tsx scripts/import-meta-spend.ts "<export.csv or .xlsx>"            # dry run: shows what would be saved
//   npx tsx scripts/import-meta-spend.ts "<export.csv or .xlsx>" --apply    # saves it
import '../src/db/load-env';
import { readFileSync } from 'node:fs';
import { parseMetaSpendExport } from '../src/lib/marketing/meta-spend-export';
import { saveCampaignSpend, SPEND_PLATFORMS } from '../src/lib/marketing/campaign-spend';

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!file) throw new Error('Usage: import-meta-spend.ts "<export.csv or .xlsx>" [--apply]');
  const bytes = readFileSync(file);
  const parsed = parseMetaSpendExport(/\.csv$/i.test(file) ? bytes.toString('utf8') : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const apply = process.argv.includes('--apply');
  if (apply) await saveCampaignSpend(parsed.rows, SPEND_PLATFORMS.meta);
  console.log(JSON.stringify({
    mode: apply ? 'saved' : 'dry run (nothing saved; add --apply)',
    period: `${parsed.from} to ${parsed.to}`, campaigns: parsed.rows.length, totalSpend: parsed.total, leftOutNoSpend: parsed.skipped,
    rows: parsed.rows.map((r) => `${r.campaign}: ₹${r.spend}${r.leads === null ? '' : ` · ${r.leads} leads`}`),
  }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
