/**
 * Rebuilds the analytics database every ANALYTICS_REFRESH_MINUTES (default 5; 0 turns it off),
 * started with CRM's other timers (instrumentation.ts). POST /api/integration/analytics/refresh
 * does the same on demand. analytics.refresh() itself takes a lock, so overlapping calls queue.
 */

import { analyticsPool } from './db';

const state = globalThis as unknown as { analyticsTimer?: ReturnType<typeof setInterval>; analyticsRunning?: Promise<unknown> };

export function refreshAnalytics(): Promise<unknown> {
  const pool = analyticsPool();
  if (!pool) return Promise.resolve(null);
  state.analyticsRunning ??= pool.query<{ refresh: unknown }>('SELECT analytics.refresh() AS refresh')
    .then((r) => r.rows[0]?.refresh ?? null)
    .finally(() => { state.analyticsRunning = undefined; });
  return state.analyticsRunning;
}

export function startAnalyticsRefreshScheduler() {
  const minutes = Number(process.env.ANALYTICS_REFRESH_MINUTES ?? 5);
  if (!analyticsPool() || !Number.isFinite(minutes) || minutes <= 0 || state.analyticsTimer) return;
  const tick = () => { refreshAnalytics().catch((error) => console.error('[analytics refresh]', error instanceof Error ? error.message : error)); };
  setTimeout(tick, 30_000).unref();
  state.analyticsTimer = setInterval(tick, minutes * 60_000);
  state.analyticsTimer.unref();
}
