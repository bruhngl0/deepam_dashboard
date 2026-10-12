import { getAuthenticatedSalesperson } from '@/lib/salesperson-auth';
import { existingCustomerDesk } from '@/lib/marketing/existing-customer-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const salesperson = await getAuthenticatedSalesperson();
  if (!salesperson) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await existingCustomerDesk(salesperson.name));
}
