/**
 * Starts the Marketing Intelligence Google Sheet sync timer, the Hemparshwa
 * sales sync timer and the analytics refresh timer when a long-running Node server boots. Skipped during `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startSheetSyncScheduler } = await import('@/lib/marketing/sheet-sync');
  startSheetSyncScheduler();
  const { startHemparshwaSyncScheduler } = await import('@/lib/integration/hemparshwa-schedule');
  startHemparshwaSyncScheduler();
  const { startAnalyticsRefreshScheduler } = await import('@/lib/analytics/refresh');
  startAnalyticsRefreshScheduler();
}
