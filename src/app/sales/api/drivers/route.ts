import { getDeskCaller } from '@/lib/salesperson-auth';
import { driverDeskResponse } from '@/lib/marketing/driver-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The drivers desk is open: every salesperson sees the whole list. */
export async function GET(request: Request) {
  const salesperson = await getDeskCaller();
  if (!salesperson) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return driverDeskResponse(request, salesperson.name);
}
