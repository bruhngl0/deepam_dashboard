/**
 * Mirrors Marketing Intelligence leads into the canonical CRM model.
 *
 * Marketing Intelligence keeps its editable calling workflow in
 * `marketing_leads`. The CRM, sales attribution and customer table use
 * `customers` + `lead_touches`. This bridge writes the same normalised phone
 * into both worlds so a Google Sheet lead and a POS bill resolve to one person.
 */

import { createHash } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, txDb } from '@/db';
import {
  campaigns as campaignsTable,
  customers as customersTable,
  importBatches,
  leadTouches as leadTouchesTable,
  stores as storesTable,
} from '@/db/schema';
import { CHANNEL_SPECS, type BulkLeadChannel } from '@/lib/import/channel-leads';
import { toStoreCode } from '@/lib/parsers/leads';
import type { Acquisition, Lead } from './local';
import { crmCampaignName, crmChannel } from './crm-sync-mapping';

export { crmCampaignName, crmChannel } from './crm-sync-mapping';

const CHUNK = 500;

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function acquisitionInstant(value: string): Date {
  const text = value.trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+05:30` : text;
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(day)
    ? `${day}+05:30`
    : day;
  const parsed = new Date(local);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

type Touch = {
  lead: Lead;
  acquisition: Acquisition;
  channel: BulkLeadChannel;
  campaignName: string;
  touchedAt: Date;
};

function touchesFor(leads: Lead[]): Touch[] {
  const deduped = new Map<string, Touch>();
  for (const lead of leads) {
    for (const acquisition of lead.acquisitions) {
      const channel = crmChannel(acquisition.source);
      const campaignName = crmCampaignName(acquisition);
      const touch = {
        lead,
        acquisition,
        channel,
        campaignName,
        touchedAt: acquisitionInstant(acquisition.at),
      };
      const key = `${lead.phone}|${channel}|${campaignName}`;
      const previous = deduped.get(key);
      if (!previous || touch.touchedAt < previous.touchedAt) deduped.set(key, touch);
    }
  }
  return [...deduped.values()];
}

function groupHash(channel: BulkLeadChannel, touches: Touch[]): string {
  const canonical = touches
    .map(({ lead, acquisition, campaignName, touchedAt }) => ({
      phone: lead.phone,
      name: lead.name,
      email: lead.email,
      city: lead.city,
      preferredStore: lead.preferredStore,
      source: acquisition.source,
      campaignName,
      touchedAt: touchedAt.toISOString(),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256')
    .update('marketing-google-sheets-to-crm-v1')
    .update(channel)
    .update(JSON.stringify(canonical))
    .digest('hex');
}

export type MarketingCrmSyncResult = {
  customersUpserted: number;
  touchesInserted: number;
  touchesSkipped: number;
  channelsSkippedUnchanged: number;
};

/** Idempotently mirror the currently connected Google Sheet lead population. */
export async function syncMarketingLeadsToCrm(
  leads: Lead[],
  uploadedBy = 'marketing-google-sheet-sync',
): Promise<MarketingCrmSyncResult> {
  const touches = touchesFor(leads);
  const result: MarketingCrmSyncResult = {
    customersUpserted: 0,
    touchesInserted: 0,
    touchesSkipped: 0,
    channelsSkippedUnchanged: 0,
  };
  if (!touches.length) return result;

  const byChannel = new Map<BulkLeadChannel, Touch[]>();
  for (const touch of touches) {
    byChannel.set(touch.channel, [...(byChannel.get(touch.channel) ?? []), touch]);
  }

  const { db: tx, pool } = txDb();
  let changed = false;
  try {
    await tx.transaction(async (t) => {
      const stores = await t.select({ id: storesTable.id, code: storesTable.code }).from(storesTable);
      const storeIdByCode = new Map(stores.map((store) => [store.code, store.id]));

      for (const [channel, channelTouches] of byChannel) {
        const hash = groupHash(channel, channelTouches);
        const [prior] = await t
          .select({ id: importBatches.id })
          .from(importBatches)
          .where(sql`${importBatches.fileHash} = ${hash} AND ${importBatches.status} = 'committed'`)
          .limit(1);
        if (prior) {
          result.channelsSkippedUnchanged++;
          continue;
        }

        changed = true;
        const campaignByName = new Map<string, { id: number; startedOn: string }>();
        for (const name of new Set(channelTouches.map((touch) => touch.campaignName))) {
          let [campaign] = await t
            .select({ id: campaignsTable.id, startedOn: campaignsTable.startedOn })
            .from(campaignsTable)
            .where(eq(campaignsTable.name, name))
            .limit(1);
          if (!campaign) {
            const first = channelTouches
              .filter((touch) => touch.campaignName === name)
              .reduce((date, touch) => (touch.touchedAt < date ? touch.touchedAt : date), new Date());
            [campaign] = await t
              .insert(campaignsTable)
              .values({
                name,
                channel,
                platform: CHANNEL_SPECS[channel].platform,
                startedOn: first.toISOString().slice(0, 10),
                notes: 'Created by the Marketing Intelligence Google Sheet sync.',
              })
              .returning({ id: campaignsTable.id, startedOn: campaignsTable.startedOn });
          }
          campaignByName.set(name, campaign);
        }

        const uniqueByPhone = new Map<string, Touch>();
        for (const touch of channelTouches) {
          const previous = uniqueByPhone.get(touch.lead.phone);
          if (!previous || touch.touchedAt < previous.touchedAt) uniqueByPhone.set(touch.lead.phone, touch);
        }
        const customerValues = [...uniqueByPhone.values()].map(({ lead, touchedAt }) => ({
          phoneE164: lead.phone,
          phoneNational: lead.phone.slice(-10),
          fullName: lead.name.trim() || null,
          nameSource: lead.name.trim() ? channel : null,
          email: lead.email.trim() || null,
          city: lead.city.trim() || null,
          preferredStoreId: toStoreCode(lead.preferredStore)
            ? (storeIdByCode.get(toStoreCode(lead.preferredStore)!) ?? null)
            : null,
          firstSeenAt: touchedAt,
          lastSeenAt: touchedAt,
        }));

        for (const part of chunk(customerValues)) {
          await t
            .insert(customersTable)
            .values(part)
            .onConflictDoUpdate({
              target: customersTable.phoneE164,
              set: {
                fullName: sql`CASE WHEN EXCLUDED.full_name IS NOT NULL
                  AND name_trust_rank(EXCLUDED.name_source) >= name_trust_rank(${customersTable.nameSource})
                  THEN EXCLUDED.full_name ELSE ${customersTable.fullName} END`,
                nameSource: sql`CASE WHEN EXCLUDED.full_name IS NOT NULL
                  AND name_trust_rank(EXCLUDED.name_source) >= name_trust_rank(${customersTable.nameSource})
                  THEN EXCLUDED.name_source ELSE ${customersTable.nameSource} END`,
                email: sql`COALESCE(${customersTable.email}, EXCLUDED.email)`,
                city: sql`COALESCE(${customersTable.city}, EXCLUDED.city)`,
                preferredStoreId: sql`COALESCE(${customersTable.preferredStoreId}, EXCLUDED.preferred_store_id)`,
                firstSeenAt: sql`LEAST(${customersTable.firstSeenAt}, EXCLUDED.first_seen_at)`,
                lastSeenAt: sql`GREATEST(${customersTable.lastSeenAt}, EXCLUDED.last_seen_at)`,
                updatedAt: new Date(),
              },
            });
        }
        result.customersUpserted += customerValues.length;

        const idByPhone = new Map<string, number>();
        for (const part of chunk([...uniqueByPhone.keys()], 1000)) {
          const found = await t
            .select({ id: customersTable.id, phone: customersTable.phoneE164 })
            .from(customersTable)
            .where(inArray(customersTable.phoneE164, part));
          for (const row of found) idByPhone.set(row.phone, row.id);
        }

        const [batch] = await t
          .insert(importBatches)
          .values({
            sourceType: channel,
            sourceKind: 'lead',
            fileName: 'Marketing Intelligence Google Sheets',
            sheetName: CHANNEL_SPECS[channel].label,
            fileHash: hash,
            status: 'committed',
            rowsTotal: channelTouches.length,
            rowsOk: channelTouches.length,
            rowsRejected: 0,
            rowsDuplicate: 0,
            uploadedBy,
            committedAt: new Date(),
          })
          .returning({ id: importBatches.id });

        const touchValues = channelTouches.map(({ lead, acquisition, campaignName, touchedAt }) => ({
          customerId: idByPhone.get(lead.phone)!,
          campaignId: campaignByName.get(campaignName)!.id,
          batchId: batch.id,
          channel,
          touchedAt,
          touchedAtIsEstimated: false,
          storePrefId: toStoreCode(lead.preferredStore)
            ? (storeIdByCode.get(toStoreCode(lead.preferredStore)!) ?? null)
            : null,
          raw: {
            sourceSystem: 'marketing_google_sheet',
            marketingLeadId: lead.id,
            source: acquisition.source,
            campaignId: acquisition.campaignId,
            acquiredAt: acquisition.at,
          },
        }));

        let insertedCount = 0;
        for (const part of chunk(touchValues)) {
          const inserted = await t
            .insert(leadTouchesTable)
            .values(part)
            .onConflictDoNothing()
            .returning({ id: leadTouchesTable.id });
          insertedCount += inserted.length;
        }
        result.touchesInserted += insertedCount;
        result.touchesSkipped += touchValues.length - insertedCount;
      }

      if (changed) await t.execute(sql`SELECT recompute_customer_lifecycle()`);
    });
  } finally {
    await pool.end();
  }

  if (changed) await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY customer_attribution`);
  return result;
}
