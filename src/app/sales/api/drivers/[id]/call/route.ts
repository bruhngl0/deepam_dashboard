import { getAuthenticatedSalesperson } from '@/lib/salesperson-auth';
import { driverCallResponse } from '@/lib/marketing/driver-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const salesperson = await getAuthenticatedSalesperson();
  if (!salesperson) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return driverCallResponse(request, (await params).id, salesperson.name);
}
