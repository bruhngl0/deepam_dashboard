import { isIntegrationAuthorized } from '@/lib/integration/auth';
import { syncHemparshwa } from '@/lib/integration/hemparshwa';
import { projectHemparshwaSales } from '@/lib/integration/hemparshwa-project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Brings CRM's copy of Hemparshwa's imported rows up to date and, when the copy
 * changed, rebuilds bills, line items and customers from it. Called on a
 * schedule (bearer `INTEGRATION_API_TOKEN`); safe to call at any time.
 * `?rebuild=1` rebuilds even when nothing changed.
 */
export async function POST(request: Request) {
  if (!isIntegrationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const sync = await syncHemparshwa();
    const changed = sync.removed.length > 0 || sync.synced.length > 0;
    const rebuild = changed || new URL(request.url).searchParams.get('rebuild') === '1';
    return Response.json({ ...sync, projection: rebuild ? await projectHemparshwaSales() : null });
  } catch (error) {
    console.error('integration/hemparshwa/sync', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Sync failed' }, { status: 502 });
  }
}
