import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { normalizePhone } from '@/lib/phone';
import { OUTCOMES, type Outcome } from './local';
import { DRIVER_PAGE_SIZE, type DriverDesk, type DriverView } from './driver-views';

export { DRIVER_VIEWS, type DriverView } from './driver-views';

/*
 * Drivers desk: one shared list of drivers. Nobody claims a driver: anyone on a calling desk (and Marketing) can call
 * any of them, and every call is kept with who made it, so the list shows who spoke to a driver last and what came of
 * it. Drivers nobody has called come first, then the ones called longest ago.
 */

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows?: T[] }).rows ?? []) as T[];
}

/** "Rehamadulla - 9844262061", one per line; also "Name, number", "Name: number" or "Name<TAB>number". */
export function parseDriverLines(text: string) {
  const drivers: { name: string; phone: string }[] = [];
  const skipped: { line: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/`+/g, '').replace(/\[cite:[^\]]*\]/gi, '').trim();
    if (!line) continue;
    const m = line.match(/^(.*?)[\s\-–—:,|]+(\+?[\d][\d\s-]{8,16}\d)\s*$/);
    if (!m) { skipped.push({ line, reason: 'No name and number' }); continue; }
    const name = m[1].replace(/[\s\-–—:,|]+$/, '').replace(/\s+/g, ' ').trim();
    const phone = normalizePhone(m[2]);
    if (!name) { skipped.push({ line, reason: 'No name' }); continue; }
    if (/^test$/i.test(name)) { skipped.push({ line, reason: 'Test entry' }); continue; }
    if (!phone.ok) { skipped.push({ line, reason: 'Not a valid Indian mobile number' }); continue; }
    if (seen.has(phone.e164)) { skipped.push({ line, reason: 'Same number twice in the list' }); continue; }
    seen.add(phone.e164);
    drivers.push({ name, phone: phone.e164 });
  }
  return { drivers, skipped };
}

/** Adds the drivers whose number isn't on the desk yet; a number already there keeps its name and calls. */
export async function addDrivers(drivers: { name: string; phone: string }[], addedBy: string) {
  if (!drivers.length) return { added: 0, existing: 0 };
  const result = await db.execute(sql`
    INSERT INTO driver_contacts (name, phone, added_by)
    SELECT d.name, d.phone, ${addedBy} FROM jsonb_to_recordset(${JSON.stringify(drivers)}::jsonb) AS d(name text, phone text)
    ON CONFLICT (phone) DO NOTHING
    RETURNING id`);
  const added = rowsOf<{ id: number }>(result).length;
  return { added, existing: drivers.length - added };
}

const VIEW_SQL: Record<DriverView, ReturnType<typeof sql>> = {
  All: sql`TRUE`,
  'Not called': sql`last.outcome IS NULL`,
  Called: sql`last.outcome IS NOT NULL`,
  Interested: sql`last.outcome = 'Connected / interested'`,
  'Call back': sql`last.outcome IN ('Callback required', 'Connected / follow-up required', 'No answer')`,
};

export async function driverDesk({ view = 'All', search = '', page = 0, caller = null as string | null, today }: { view?: DriverView; search?: string; page?: number; caller?: string | null; today: string }): Promise<DriverDesk> {
  const digits = search.replace(/\D/g, '');
  const term = search.trim().toLowerCase();
  const searchSql = !term ? sql`TRUE`
    : digits.length >= 3 ? sql`(d.phone LIKE ${'%' + digits + '%'} OR lower(d.name) LIKE ${'%' + term + '%'})`
    : sql`lower(d.name) LIKE ${'%' + term + '%'}`;
  const base = sql`
    FROM driver_contacts d
    LEFT JOIN LATERAL (
      SELECT c.caller, c.outcome, c.note, to_char(c.called_at, 'YYYY-MM-DD"T"HH24:MI') AS called_at
      FROM driver_calls c WHERE c.driver_id = d.id ORDER BY c.called_at DESC, c.id DESC LIMIT 1
    ) last ON TRUE`;
  const [summary, filtered, rows] = await Promise.all([
    db.execute(sql`
      SELECT (SELECT count(*) FROM driver_contacts)::int AS total,
        (SELECT count(DISTINCT driver_id) FROM driver_calls)::int AS called,
        (SELECT count(*) FROM driver_calls WHERE called_at >= ${today}::date AND called_at < ${today}::date + 1)::int AS calls_today,
        (SELECT count(*) FROM driver_calls WHERE lower(caller) = lower(${caller ?? ''}) AND called_at >= ${today}::date AND called_at < ${today}::date + 1)::int AS my_calls_today`),
    db.execute(sql`SELECT count(*)::int AS n ${base} WHERE ${VIEW_SQL[view]} AND ${searchSql}`),
    db.execute(sql`
      SELECT d.id, d.name, d.phone, last.caller, last.outcome, last.note, last.called_at,
        (SELECT count(*) FROM driver_calls c WHERE c.driver_id = d.id)::int AS calls,
        (SELECT coalesce(json_agg(r ORDER BY r.at DESC), '[]'::json) FROM (
          SELECT c.caller, c.outcome, c.note, to_char(c.called_at, 'YYYY-MM-DD"T"HH24:MI') AS at, c.called_at
          FROM driver_calls c WHERE c.driver_id = d.id ORDER BY c.called_at DESC, c.id DESC LIMIT 5) r) AS recent
      ${base}
      WHERE ${VIEW_SQL[view]} AND ${searchSql}
      ORDER BY last.called_at ASC NULLS FIRST, d.id
      LIMIT ${DRIVER_PAGE_SIZE} OFFSET ${page * DRIVER_PAGE_SIZE}`),
  ]);
  const s = rowsOf<{ total: number; called: number; calls_today: number; my_calls_today: number }>(summary)[0];
  type Raw = { id: number | string; name: string; phone: string; caller: string | null; outcome: Outcome | null; note: string | null; called_at: string | null; calls: number; recent: { caller: string; outcome: Outcome; note: string; at: string }[] };
  return {
    total: s.total, called: s.called, notCalled: s.total - s.called, callsToday: s.calls_today, myCallsToday: caller ? s.my_calls_today : null,
    view, filtered: rowsOf<{ n: number }>(filtered)[0].n, page, pageSize: DRIVER_PAGE_SIZE,
    rows: rowsOf<Raw>(rows).map(r => ({
      id: Number(r.id), name: r.name, phone: r.phone.replace(/^\+91/, ''), calls: r.calls,
      last: r.outcome ? { caller: r.caller ?? '', outcome: r.outcome, note: r.note ?? '', calledAt: r.called_at ?? '' } : null,
      recent: (r.recent ?? []).map(c => ({ caller: c.caller, outcome: c.outcome, note: c.note, calledAt: c.at })),
    })),
  };
}

export function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

/** Logs a call; false when the driver isn't on the desk (removed meanwhile). */
export async function logDriverCall(input: { id: number; caller: string; outcome: Outcome; note: string; calledAt: string }) {
  const result = await db.execute(sql`
    INSERT INTO driver_calls (driver_id, caller, outcome, note, called_at)
    SELECT id, ${input.caller}, ${input.outcome}, ${input.note}, ${input.calledAt}::timestamp FROM driver_contacts WHERE id = ${input.id}
    RETURNING id`);
  return rowsOf(result).length > 0;
}
