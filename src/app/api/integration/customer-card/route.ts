import { isIntegrationAuthorized } from '@/lib/integration/auth';
import { getCustomerCard } from '@/lib/queries/customer-timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What WalkTrack shows at the counter when a Contact No. is typed: who the
 * customer is, their value tier, last purchase, last call, open follow-up and
 * last walk-in. No rupee amounts (the counter is a shared screen). Read-only.
 *
 * Body `{ contactNo, walkIn? }`: a 10-digit number or a Customer ID, and the
 * WalkTrack walk-in being viewed so it is not reported as its own last visit.
 */
export async function POST(request: Request) {
  if (!isIntegrationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { contactNo?: unknown; walkIn?: unknown } | null;
  const contactNo = typeof body?.contactNo === 'string' ? body.contactNo.slice(0, 40) : null;
  const walkIn = typeof body?.walkIn === 'string' ? body.walkIn.slice(0, 100) : undefined;
  if (!contactNo) return Response.json({ error: 'Expected { contactNo: string }' }, { status: 422 });
  try {
    return Response.json(await getCustomerCard(contactNo, walkIn), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('integration/customer-card', error);
    return Response.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
