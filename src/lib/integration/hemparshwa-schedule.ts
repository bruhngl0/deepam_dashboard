/**
 * Runs the Hemparshwa sync and, when CRM's copy changed, the rebuild — the one
 * entry point for both the sync route and the in-process timer.
 *
 * The timer runs every `HEMPARSHWA_SYNC_HOURS` (default 5; 0 turns it off)
 * wherever `HEMPARSHWA_URL` and `HEMPARSHWA_INTEGRATION_TOKEN` are set, with a
 * first run shortly after boot. App Runner throttles a container's CPU while
 * it serves no requests, so a tick can run late on a quiet service; calling
 * `POST /api/integration/hemparshwa/sync` does the same job on demand.
 */

import { syncHemparshwa, type SyncResult } from './hemparshwa';
import type { ProjectionResult } from './hemparshwa-project';

export type HemparshwaRun = SyncResult & { projection: ProjectionResult | null };

const state = globalThis as unknown as {
  hemparshwaSyncTimer?: ReturnType<typeof setInterval>;
  hemparshwaSyncRunning?: Promise<HemparshwaRun>;
};

/** One run at a time: a call that arrives during a run gets that run's result. */
export function runHemparshwaSync(forceRebuild = false): Promise<HemparshwaRun> {
  state.hemparshwaSyncRunning ??= (async () => {
    const sync = await syncHemparshwa();
    const changed = sync.removed.length > 0 || sync.synced.length > 0;
    if (!changed && !forceRebuild) return { ...sync, projection: null };
    // Loaded only when needed: it pulls in the database client.
    const { projectHemparshwaSales } = await import('./hemparshwa-project');
    return { ...sync, projection: await projectHemparshwaSales() };
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
  const hours = syncIntervalHours();
  if (!hours || state.hemparshwaSyncTimer) return;
  if (!process.env.HEMPARSHWA_URL || !process.env.HEMPARSHWA_INTEGRATION_TOKEN) return;
  const tick = () => {
    runHemparshwaSync()
      .then((run) => {
        if (run.projection) console.log('[hemparshwa sync]', JSON.stringify(run));
      })
      .catch((error) => console.error('[hemparshwa sync]', error));
  };
  setTimeout(tick, 30_000).unref();
  state.hemparshwaSyncTimer = setInterval(tick, hours * 3_600_000);
  state.hemparshwaSyncTimer.unref();
}

/**
 * Empties CRM's copy of Hemparshwa's sales and everything built from it (bills
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
