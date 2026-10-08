import { isIntegrationAuthorized } from '@/lib/integration/auth';
import { clearHemparshwaSales } from '@/lib/integration/hemparshwa-schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Empties CRM's copy of Hemparshwa's sales and the bills and line items built
 * from it (bearer `INTEGRATION_API_TOKEN`). Customers stay. The next sync
 * brings back whatever Hemparshwa still holds.
 */
export async function POST(request: Request) {
  if (!isIntegrationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return Response.json(await clearHemparshwaSales());
  } catch (error) {
    console.error('integration/hemparshwa/clear', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Clear failed' }, { status: 500 });
  }
}
