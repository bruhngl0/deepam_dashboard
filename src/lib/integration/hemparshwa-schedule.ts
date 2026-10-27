/**
 * Runs the Hemparshwa sync and, when CRM's copy changed, the rebuild — the one
 * entry point for both the sync route and the in-process timer. Every run ends by
 * copying new conversions (bills from marketing leads) into Marketing Intelligence.
 *
 * The timer runs every `HEMPARSHWA_SYNC_HOURS` (default 5; 0 turns it off)
 * wherever `HEMPARSHWA_URL` and `HEMPARSHWA_INTEGRATION_TOKEN` are set, with a
 * first run shortly after boot. App Runner throttles a container's CPU while
 * it serves no requests, so a tick can run late on a quiet service; calling
 * `POST /api/integration/hemparshwa/sync` does the same job on demand.
 */

import { syncHemparshwa, type SyncResult } from './hemparshwa';
import type { CustomerProjectionResult, ProjectionResult } from './hemparshwa-project';
import type { HemparshwaIdsResult } from './hemparshwa-ids';
import type { CrmConversionSync } from '@/lib/marketing/crm-conversions';
import { startWalkInPushScheduler, type WalkInPush } from './hemparshwa-walkins';

export type HemparshwaRun = SyncResult & {
  customers: CustomerProjectionResult | null;
  projection: ProjectionResult | null;
  /** Hemparshwa renumbered to CRM's IDs (hemparshwa-ids.ts); an error here never fails the sync. */
  ids: HemparshwaIdsResult | { error: string } | null;
  /** Bills from marketing leads copied into Marketing Intelligence (crm-conversions.ts); an error here never fails the sync. */
  conversions: CrmConversionSync | { error: string } | null;
  /** WalkTrack walk-ins sent to Hemparshwa (hemparshwa-walkins.ts); an error here never fails the sync. */
  walkIns: WalkInPush | { error: string } | null;
};

const state = globalThis as unknown as {
  hemparshwaSyncTimer?: ReturnType<typeof setInterval>;
  hemparshwaSyncRunning?: Promise<HemparshwaRun>;
};

/** One run at a time: a call that arrives during a run gets that run's result. */
export function runHemparshwaSync(forceRebuild = false): Promise<HemparshwaRun> {
  state.hemparshwaSyncRunning ??= (async () => {
    const sync = await syncHemparshwa();
    const changed = sync.removed.length > 0 || sync.synced.length > 0;
    let customers: CustomerProjectionResult | null = null;
    let projection: ProjectionResult | null = null;
    if (changed || forceRebuild) {
      // Loaded only when needed: it pulls in the database client.
      const { projectHemparshwaCustomers, projectHemparshwaSales } = await import('./hemparshwa-project');
      // The Customer Master first: the sales rebuild ends by refreshing what the customer screens read.
      customers = await projectHemparshwaCustomers();
      projection = await projectHemparshwaSales();
    }
    // Every run, changed or not: someone may have become a customer in CRM since the last one.
    const { assignHemparshwaIds } = await import('./hemparshwa-ids');
    const ids = await assignHemparshwaIds().catch((error: unknown) => {
      console.error('[hemparshwa ids]', error);
      return { error: error instanceof Error ? error.message : String(error) };
    });
    // Every run too: new bills, or new leads whose phone already has a later bill, become Marketing Intelligence conversions.
    const { syncConversionsFromCrm } = await import('@/lib/marketing/crm-conversions');
    const conversions = await syncConversionsFromCrm().catch((error: unknown) => {
      console.error('[marketing conversions]', error);
      return { error: error instanceof Error ? error.message : String(error) };
    });
    // And WalkTrack's walk-ins to Hemparshwa, for its MIS footfall (also on its own, faster timer).
    const { runWalkInPush } = await import('./hemparshwa-walkins');
    const walkIns = await runWalkInPush().catch((error: unknown) => {
      console.error('[hemparshwa walk-ins]', error);
      return { error: error instanceof Error ? error.message : String(error) };
    });
    return { ...sync, customers, projection, ids, conversions, walkIns };
  })().finally(() => {
    state.hemparshwaSyncRunning = undefined;
  });
  return state.hemparshwaSyncRunning;
}

export function syncIntervalHours(): number {
  const hours = Number(process.env.HEMPARSHWA_SYNC_HOURS ?? 5);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

/** In-process timer for the long-running Node server. */
export function startHemparshwaSyncScheduler() {
  startWalkInPushScheduler();
  const hours = syncIntervalHours();
  if (!hours || state.hemparshwaSyncTimer) return;
  if (!process.env.HEMPARSHWA_URL || !process.env.HEMPARSHWA_INTEGRATION_TOKEN) return;
  const tick = () => {
    runHemparshwaSync()
      .then((run) => {
        if (run.projection || (run.conversions && 'billsAdded' in run.conversions && run.conversions.billsAdded > 0)) console.log('[hemparshwa sync]', JSON.stringify(run));
      })
      .catch((error) => console.error('[hemparshwa sync]', error));
  };
  setTimeout(tick, 30_000).unref();
  state.hemparshwaSyncTimer = setInterval(tick, hours * 3_600_000);
  state.hemparshwaSyncTimer.unref();
}

/**
 * Empties CRM's copy of Hemparshwa's imports and everything built from it (bills
 * and line items; customers stay). The next sync brings back whatever
 * Hemparshwa still holds.
 */
export async function clearHemparshwaSales(): Promise<ProjectionResult> {
  await state.hemparshwaSyncRunning?.catch(() => {});
  const { sql } = await import('drizzle-orm');
  const { db } = await import('@/db');
  const { projectHemparshwaSales } = await import('./hemparshwa-project');
  // The rebuild removes the bills of every batch that no longer has an import.
  await db.execute(sql`DELETE FROM hemparshwa_imports`);
  return projectHemparshwaSales();
}
