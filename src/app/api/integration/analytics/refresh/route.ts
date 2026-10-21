import { isIntegrationAuthorized } from '@/lib/integration/auth';
import { analyticsConfigured } from '@/lib/analytics/db';
import { refreshAnalytics } from '@/lib/analytics/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Rebuilds the analytics database now (bearer INTEGRATION_API_TOKEN); the timer does it every few minutes. */
export async function POST(request: Request) {
  if (!isIntegrationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!analyticsConfigured()) return Response.json({ error: 'ANALYTICS_DATABASE_URL is not set.' }, { status: 503 });
  try {
    return Response.json({ ok: true, counts: await refreshAnalytics() });
  } catch (error) {
    console.error('integration/analytics/refresh', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Refresh failed' }, { status: 500 });
  }
}
