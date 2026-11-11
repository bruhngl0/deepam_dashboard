// Loads Google ad spend from a Google Ads billing activity report (Billing → Transactions → download).
// It replaces saved Google spend only for the report's days, by campaign and day, the same rows the
// Google Ads API sync saves (scripts/sync-google-ads-spend.ts). When the API sync is set up it replaces
// all Google spend each hour, so this is for while it is not. Cost is before GST.
//
//   npx tsx scripts/import-google-spend.ts "<report.xlsx or .csv>"            # dry run: shows what would be saved
//   npx tsx scripts/import-google-spend.ts "<report.xlsx or .csv>" --apply    # saves it
import '../src/db/load-env';
import { readFileSync } from 'node:fs';
import { parseGoogleBillingExport } from '../src/lib/marketing/google-ads-billing-export';
import { saveCampaignSpend, SPEND_PLATFORMS } from '../src/lib/marketing/campaign-spend';

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!file) throw new Error('Usage: import-google-spend.ts "<report.xlsx or .csv>" [--apply]');
  const bytes = readFileSync(file);
  const parsed = parseGoogleBillingExport(/\.csv$/i.test(file) ? bytes.toString('utf8') : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (!parsed.from || !parsed.to) throw new Error('The report has no period and no campaign days.');
  const apply = process.argv.includes('--apply');
  if (apply) await saveCampaignSpend(parsed.rows, SPEND_PLATFORMS.google, { from: parsed.from, to: parsed.to });
  const byCampaign = new Map<string, number>();
  for (const row of parsed.rows) byCampaign.set(row.campaign, (byCampaign.get(row.campaign) ?? 0) + row.spend);
  const byMonth = new Map<string, number>();
  for (const row of parsed.rows) byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.spend);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  console.log(JSON.stringify({
    mode: apply ? 'saved' : 'dry run (nothing saved; add --apply)',
    period: `${parsed.from} to ${parsed.to}`, campaignDays: parsed.rows.length, totalSpend: parsed.total, gstNotIncluded: parsed.taxes,
    byMonth: Object.fromEntries([...byMonth].map(([m, v]) => [m, r2(v)])),
    rows: [...byCampaign].sort((a, b) => b[1] - a[1]).map(([name, spend]) => `${name}: ₹${r2(spend)}`),
  }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
