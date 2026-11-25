import { requireApiUser } from '@/lib/auth';
import { driverCallResponse } from '@/lib/marketing/driver-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A call made from Marketing → Drivers; it has no personal login, so it is kept as the Marketing team's. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  return driverCallResponse(request, (await params).id, 'Marketing team');
}
