/**
 * "Sync now" on the Import page: pulls new sales imports from Hemparshwa OS
 * without waiting for the timer. Same run as the timer and the integration
 * route; a click during a run gets that run's result.
 */

import { runHemparshwaSync } from '@/lib/integration/hemparshwa-schedule';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await runHemparshwaSync());
  } catch (e) {
    console.error('import/hemparshwa-sync', e);
    return Response.json({ error: e instanceof Error ? e.message : 'Sync failed.' }, { status: 502 });
  }
}
