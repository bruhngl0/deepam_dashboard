/**
 * Seed reference data: the two stores and the five Meta campaigns.
 *
 *   npm run db:seed
 *
 * Idempotent — safe to run repeatedly.
 */

import './load-env';
import { db } from './index';
import { stores, campaigns } from './schema';
import { sql } from 'drizzle-orm';

/**
 * Voucher prefix → store. The POS export has no branch column, so this mapping
 * is the only thing that assigns a bill to a store. (D-26)
 *
 * Derived by cross-referencing walk-in visitors who named a store against the
 * prefix they were billed on:
 *
 *              declared MG Road   declared Jayanagar
 *   BK01-                   146                    6
 *   BK02-                     0                  214
 *
 * Corroborated by Meta's preferred_store field. Have the store manager confirm
 * once; if it is wrong, every per-store number inverts and nothing else breaks.
 */
const STORES = [
  { code: 'MG_ROAD', name: 'MG Road', voucherPrefix: 'BK01-' },
  { code: 'JAYANAGAR', name: 'Jayanagar', voucherPrefix: 'BK02-' },
];

/**
 * One campaign per Meta sheet (D-07), plus the WhatsApp broadcast and the
 * standing walk-in form.
 *
 * `startedOn` is required: it is the fallback timestamp for every channel that
 * ships no per-lead date, which is Meta and WhatsApp both. (D-29, D-30)
 * The dates below cover the 19-26 July 2026 export window — adjust if you know
 * the true campaign start.
 */
const CAMPAIGNS = [
  {
    name: 'Varamahalakshmi — Main Campaign',
    channel: 'meta' as const,
    platform: 'instagram',
    startedOn: '2026-07-19',
    endedOn: '2026-07-26',
    notes: 'Meta workbook sheet: "Main Campaign"',
  },
  {
    name: 'Varamahalakshmi — CAM 4 (25-27 Jul)',
    channel: 'meta' as const,
    platform: 'instagram',
    startedOn: '2026-07-25',
    endedOn: '2026-07-27',
    notes: 'Meta workbook sheet: "CAM - 4 (25th - 27th )"',
  },
  {
    name: 'Varamahalakshmi — Cam 2 (Weekend)',
    channel: 'meta' as const,
    platform: 'instagram',
    startedOn: '2026-07-19',
    endedOn: '2026-07-26',
    notes: 'Meta workbook sheet: "Cam - 2 (Weekend)"',
  },
  {
    name: 'Varamahalakshmi — Camp 4',
    channel: 'meta' as const,
    platform: 'instagram',
    startedOn: '2026-07-19',
    endedOn: '2026-07-26',
    notes: 'Meta workbook sheet: "Camp - 4"',
  },
  {
    name: 'Varamahalakshmi — Private Preview',
    channel: 'meta' as const,
    platform: 'instagram',
    startedOn: '2026-07-19',
    endedOn: '2026-07-26',
    notes: 'Meta workbook sheet: "Private Preview"',
  },
  {
    name: 'Varamahalakshmi — WhatsApp Broadcast',
    channel: 'whatsapp' as const,
    platform: 'whatsapp_business',
    startedOn: '2026-07-19',
    endedOn: '2026-07-26',
    notes:
      'Delivery report only: phone numbers, no names, no timestamps. 6,962 rows, 3,696 unique.',
  },
  {
    name: 'Store Walk-in Onboarding',
    channel: 'walkin' as const,
    platform: null,
    startedOn: '2026-07-19',
    endedOn: null,
    notes: 'Standing in-store onboarding form. Carries real per-row timestamps.',
  },
];

async function main() {
  console.log('Seeding reference data…\n');

  for (const store of STORES) {
    await db
      .insert(stores)
      .values(store)
      .onConflictDoUpdate({
        target: stores.code,
        set: { name: store.name, voucherPrefix: store.voucherPrefix },
      });
    console.log(`  store     ${store.name.padEnd(12)} ${store.voucherPrefix}`);
  }

  console.log('');

  for (const campaign of CAMPAIGNS) {
    await db
      .insert(campaigns)
      .values(campaign)
      .onConflictDoNothing({
        target: [campaigns.name, campaigns.startedOn],
      });
    console.log(`  campaign  ${campaign.channel.padEnd(10)} ${campaign.name}`);
  }

  const [{ count: storeCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stores);
  const [{ count: campaignCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns);

  console.log(`\n✓ ${storeCount} stores, ${campaignCount} campaigns\n`);
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
