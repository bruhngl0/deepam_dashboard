import { timingSafeEqual } from 'node:crypto';
import { MAX_PUNCHES, parsePunch, receivePunches } from '@/lib/hr/attendance-punches';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Its own token (ATTENDANCE_SYNC_TOKEN), not the shared integration one: it lives on the office PC. */
function authorized(request: Request) {
  const expected = process.env.ATTENDANCE_SYNC_TOKEN;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Punches from the biometric machine, posted by scripts/attendance-agent on the office PC.
 * Body `{ device?: string, punches: [{ userId, at: "YYYY-MM-DD HH:mm:ss" (IST), io: 0 | 1 (0 = IN), downloadedAt? }] }`.
 * Repeats are ignored, so the job can safely send overlapping batches. HR → Attendance shows the result.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { device?: unknown; punches?: unknown } | null;
  const list = body?.punches;
  if (!Array.isArray(list) || list.length > MAX_PUNCHES) return Response.json({ error: `Expected { punches: [...] } with at most ${MAX_PUNCHES}` }, { status: 422 });
  const punches = list.map(parsePunch);
  const bad = punches.findIndex((p) => !p);
  if (bad >= 0) return Response.json({ error: `Punch ${bad + 1} is not { userId, at: "YYYY-MM-DD HH:mm:ss", io: 0 | 1 }`, punch: list[bad] }, { status: 422 });
  const device = typeof body?.device === 'string' && /^[\w .-]{1,40}$/.test(body.device) ? body.device : 'cosec';
  try {
    return Response.json(await receivePunches(punches.filter((p) => p !== null), device), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('integration/attendance/punches', error);
    return Response.json({ error: 'Could not store the punches' }, { status: 500 });
  }
}
