/**
 * Starts the Marketing Intelligence Google Sheet sync timer when a long-running
 * Node server boots. Skipped during `next build` and on Vercel, where there is
 * no process to keep a timer alive; there the cron route does the same job.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.VERCEL || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startSheetSyncScheduler } = await import('@/lib/marketing/sheet-sync');
  startSheetSyncScheduler();
}
