// Loads Google ad spend from the Google Ads API, replacing saved Google spend (Meta is not touched).
//
//   npx tsx scripts/sync-google-ads-spend.ts            # dry run: shows what would be saved
//   npx tsx scripts/sync-google-ads-spend.ts --apply    # saves it
import '../src/db/load-env';
import { syncGoogleAdsSpend } from '../src/lib/marketing/google-ads-spend';

async function main() {
  const apply = process.argv.includes('--apply');
  const result = await syncGoogleAdsSpend({ apply });
  if (result.state === 'off') throw new Error(result.missing);
  const byCampaign = new Map<string, number>();
  for (const row of result.rows ?? []) byCampaign.set(row.campaign, (byCampaign.get(row.campaign) ?? 0) + row.spend);
  console.log(JSON.stringify({
    mode: apply ? 'saved' : 'dry run (nothing saved; add --apply)',
    period: `${result.from} to ${result.to}`, campaigns: result.campaigns, campaignDays: result.days, totalSpend: result.total,
    rows: [...byCampaign].sort((a, b) => b[1] - a[1]).map(([name, spend]) => `${name}: ₹${Math.round(spend * 100) / 100}`),
  }, null, 2));
  process.exit(0);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
