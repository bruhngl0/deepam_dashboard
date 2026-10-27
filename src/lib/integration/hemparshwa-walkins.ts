/**
 * CRM → Hemparshwa OS: every WalkTrack walk-in, for the footfall, conversion and driver sales on
 * Hemparshwa's MIS dashboard. WalkTrack delivers its walk-ins to CRM every minute (`store_visits`);
 * Hemparshwa has no outbound internet, so CRM sends the full list to
 * `POST {HEMPARSHWA_URL}/api/integration/walk-ins`, which replaces Hemparshwa's copy.
 *
 * Runs on every Hemparshwa sync and on its own timer every `HEMPARSHWA_WALKINS_MINUTES` (default
 * 15; 0 turns the timer off).
 */

import { sql } from 'drizzle-orm';

export type WalkInPush = { sent: number; walkIns?: number; byStore?: Record<string, number>; unmapped?: string[] };

const rowsOf = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);

export async function pushWalkInsToHemparshwa(): Promise<WalkInPush> {
  const base = process.env.HEMPARSHWA_URL?.replace(/\/+$/, '');
  const token = process.env.HEMPARSHWA_INTEGRATION_TOKEN;
  if (!base || !token) throw new Error('HEMPARSHWA_URL and HEMPARSHWA_INTEGRATION_TOKEN are not set.');
  const walkIns = await loadWalkIns();
  const res = await fetch(`${base}/api/integration/walk-ins`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ walkIns }),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({})) as Omit<WalkInPush, 'sent'> & { error?: string; rejected?: string[] };
  if (!res.ok) throw new Error(`Hemparshwa walk-ins answered ${res.status}: ${body.error ?? ''} ${(body.rejected ?? []).join('; ')}`.trim());
  return { sent: walkIns.length, walkIns: body.walkIns, byStore: body.byStore, unmapped: body.unmapped };
}

/** Every live WalkTrack walk-in in the shape Hemparshwa takes. */
export async function loadWalkIns(): Promise<Record<string, unknown>[]> {
  const { db } = await import('@/db');
  // The store day WalkTrack logged it under (its `date`), else the IST day of the start time.
  return rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT v.external_id AS id, st.code AS store,
           COALESCE(substring(v.raw->>'date' from '^[0-9]{4}-[0-9]{2}-[0-9]{2}'),
                    to_char(v.visited_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')) AS day,
           v.people, v.staff_converted AS converted,
           NULLIF(v.raw->>'billNo', '') AS "billNo",
           CASE WHEN (v.raw->>'billAmount') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (v.raw->>'billAmount')::float END AS "billAmount",
           COALESCE((v.raw->>'referredByDriver')::boolean, v.driver_code IS NOT NULL) AS "referredByDriver",
           v.driver_code AS "driverCode", v.source, v.shopping_intent AS "shoppingIntent"
    FROM store_visits v JOIN stores st ON st.id = v.store_id
    WHERE v.deleted_at IS NULL AND v.source_system = 'walktrack'
    ORDER BY v.visited_at`));
}

const state = globalThis as unknown as { hemparshwaWalkInTimer?: ReturnType<typeof setInterval>; hemparshwaWalkInRunning?: Promise<WalkInPush> };

/** One push at a time: a call during a push gets that push's result. */
export function runWalkInPush(): Promise<WalkInPush> {
  state.hemparshwaWalkInRunning ??= pushWalkInsToHemparshwa().finally(() => { state.hemparshwaWalkInRunning = undefined; });
  return state.hemparshwaWalkInRunning;
}

export function startWalkInPushScheduler() {
  const minutes = Number(process.env.HEMPARSHWA_WALKINS_MINUTES ?? 15);
  if (!Number.isFinite(minutes) || minutes <= 0 || state.hemparshwaWalkInTimer) return;
  if (!process.env.HEMPARSHWA_URL || !process.env.HEMPARSHWA_INTEGRATION_TOKEN) return;
  const tick = () => { runWalkInPush().catch((error) => console.error('[hemparshwa walk-ins]', error)); };
  setTimeout(tick, 60_000).unref();
  state.hemparshwaWalkInTimer = setInterval(tick, minutes * 60_000);
  state.hemparshwaWalkInTimer.unref();
}
