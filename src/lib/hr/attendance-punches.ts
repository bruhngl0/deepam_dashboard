/**
 * Punches from the biometric machine (drizzle/0040) and the attendance days worked out from them.
 *
 * A day, per employee (punches matched by employees.biometric_id = the machine's UserID, leading zeros ignored):
 *   - In: the first IN punch (the first punch of the day if none is marked IN).
 *   - Out: the last OUT punch (the last punch, if there are two or more and none is marked OUT).
 *   - Status: Half day when both are there and less than HALF_DAY_HOURS apart, otherwise Present.
 * Days with no punches are left empty, not marked Absent: week offs and leave are not on the machine.
 * A day HR typed in (source 'manual') is never overwritten.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';

export const HALF_DAY_HOURS = 5;
export const MAX_PUNCHES = 5000;

const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));
/** "2026-11-17 09:58:12" or "2026-11-17T09:58:12(.123)": the machine's local time, IST. */
const LOCAL = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/;

export type Punch = { userId: string; at: string; direction: 'in' | 'out'; downloadedAt: string | null };

/** Checks one posted punch: { userId, at, io (0 = IN, 1 = OUT), downloadedAt? }. */
export function parsePunch(value: unknown): Punch | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const userId = typeof v.userId === 'string' || typeof v.userId === 'number' ? String(v.userId).trim() : '';
  const at = typeof v.at === 'string' ? v.at.trim().match(LOCAL) : null;
  const io = Number(v.io);
  const down = typeof v.downloadedAt === 'string' ? v.downloadedAt.trim().match(LOCAL) : null;
  if (!userId || userId.length > 40 || !at || (io !== 0 && io !== 1)) return null;
  return { userId, at: `${at[1]}T${at[2]}+05:30`, direction: io === 0 ? 'in' : 'out', downloadedAt: down ? `${down[1]}T${down[2]}+05:30` : null };
}

/** Stores the punches (repeats are ignored) and works out the attendance days they touch. */
export async function receivePunches(punches: Punch[], device = 'cosec') {
  if (!punches.length) return { received: 0, inserted: 0, daysUpdated: 0, unmatchedIds: [] as string[] };
  const inserted = rowsOf<{ n: string }>(await db.execute(sql`
    WITH incoming AS (
      SELECT * FROM json_to_recordset(${JSON.stringify(punches)}::json) AS x("userId" text, at timestamptz, direction text, "downloadedAt" timestamptz)
    ), ins AS (
      INSERT INTO attendance_punches (device, device_user_id, punched_at, direction, downloaded_at)
      SELECT ${device}, "userId", at, direction, "downloadedAt" FROM incoming
      ON CONFLICT (device, device_user_id, punched_at, direction) DO NOTHING
      RETURNING 1
    ) SELECT count(*) AS n FROM ins`))[0];
  const days = [...new Set(punches.map((p) => p.at.slice(0, 10)))];
  const daysUpdated = await rebuildDays(days);
  const ids = [...new Set(punches.map((p) => p.userId))];
  const unmatched = rowsOf<{ id: string }>(await db.execute(sql`
    SELECT id FROM unnest(string_to_array(${ids.join(',')}, ',')) AS id
    WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE ltrim(e.biometric_id, '0') = ltrim(id, '0'))`)).map((r) => r.id);
  return { received: punches.length, inserted: Number(inserted?.n ?? 0), daysUpdated, unmatchedIds: unmatched };
}

/**
 * Works out attendance_days for the given IST days from the punches, plus any day in the last 62 with matched punches
 * and no attendance row yet (an employee whose Biometric ID was filled in after their punches arrived).
 */
export async function rebuildDays(days: string[]) {
  const result = rowsOf<{ n: string }>(await db.execute(sql`
    WITH p AS (
      SELECT e.employee_code, (ap.punched_at AT TIME ZONE 'Asia/Kolkata')::date AS day, ap.punched_at, ap.direction, ap.device
      FROM attendance_punches ap JOIN employees e ON ltrim(e.biometric_id, '0') = ltrim(ap.device_user_id, '0')
      WHERE ap.punched_at >= now() - interval '400 days'
    ), wanted AS (
      SELECT DISTINCT employee_code, day FROM p
      WHERE day = ANY(string_to_array(${days.join(',')}, ',')::date[])
         OR (day >= current_date - 62 AND NOT EXISTS (SELECT 1 FROM attendance_days a WHERE a.employee_code = p.employee_code AND a.day = p.day))
    ), agg AS (
      SELECT p.employee_code, p.day, max(p.device) AS device, count(*) AS n,
        min(p.punched_at) FILTER (WHERE p.direction = 'in') AS first_in, min(p.punched_at) AS first_any,
        max(p.punched_at) FILTER (WHERE p.direction = 'out') AS last_out, max(p.punched_at) AS last_any
      FROM p JOIN wanted w USING (employee_code, day) GROUP BY p.employee_code, p.day
    ), day_rows AS (
      SELECT employee_code, day, device, coalesce(first_in, first_any) AS in_at,
        CASE WHEN coalesce(last_out, CASE WHEN n > 1 THEN last_any END) > coalesce(first_in, first_any)
             THEN coalesce(last_out, CASE WHEN n > 1 THEN last_any END) END AS out_at
      FROM agg
    ), up AS (
      INSERT INTO attendance_days (employee_code, day, status, in_at, out_at, source, device, updated_at)
      SELECT employee_code, day,
        CASE WHEN out_at IS NOT NULL AND out_at - in_at < make_interval(hours => ${HALF_DAY_HOURS}) THEN 'Half day' ELSE 'Present' END,
        in_at, out_at, 'biometric', device, now()
      FROM day_rows
      ON CONFLICT (employee_code, day) DO UPDATE SET status = EXCLUDED.status, in_at = EXCLUDED.in_at, out_at = EXCLUDED.out_at,
        device = EXCLUDED.device, updated_at = now()
      WHERE attendance_days.source = 'biometric'
      RETURNING 1
    ) SELECT count(*) AS n FROM up`))[0];
  return Number(result?.n ?? 0);
}

/** For the Attendance page: when the machine last sent punches, and its UserIDs not linked to an employee. */
export async function punchStatus(from: string, to: string) {
  const [last, unmatched] = await Promise.all([
    db.execute(sql`SELECT max(received_at) AS received, max(punched_at) AS punched FROM attendance_punches`),
    db.execute(sql`
      SELECT ap.device_user_id AS id, count(*) AS punches, max(ap.punched_at) AS last
      FROM attendance_punches ap
      WHERE (ap.punched_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
        AND NOT EXISTS (SELECT 1 FROM employees e WHERE ltrim(e.biometric_id, '0') = ltrim(ap.device_user_id, '0'))
      GROUP BY ap.device_user_id ORDER BY count(*) DESC`),
  ]);
  const l = rowsOf<{ received: Date | string | null; punched: Date | string | null }>(last)[0];
  const iso = (v: Date | string | null | undefined) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  return {
    lastReceived: iso(l?.received), lastPunch: iso(l?.punched),
    unmatched: rowsOf<{ id: string; punches: string; last: Date | string }>(unmatched).map((r) => ({ id: r.id, punches: Number(r.punches), last: iso(r.last)! })),
  };
}
