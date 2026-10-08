import { isIntegrationAuthorized } from '@/lib/integration/auth';
import { runHemparshwaSync } from '@/lib/integration/hemparshwa-schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Brings CRM's copy of Hemparshwa's imported rows up to date and, when the copy
 * changed, rebuilds bills, line items and customers from it. The server's own
 * timer does this every few hours (lib/integration/hemparshwa-schedule.ts);
 * this route does it on demand (bearer `INTEGRATION_API_TOKEN`).
 * `?rebuild=1` rebuilds even when nothing changed.
 */
export async function POST(request: Request) {
  if (!isIntegrationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await runHemparshwaSync(new URL(request.url).searchParams.get('rebuild') === '1'));
  } catch (error) {
    console.error('integration/hemparshwa/sync', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Sync failed' }, { status: 502 });
  }
}
