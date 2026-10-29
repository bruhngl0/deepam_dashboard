import { getAuthenticatedSalesperson } from '@/lib/salesperson-auth';
import { existingCustomerDesk } from '@/lib/marketing/existing-customer-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const day = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

export async function GET(req: Request) {
  const salesperson = await getAuthenticatedSalesperson();
  if (!salesperson) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(req.url).searchParams;
  return Response.json(await existingCustomerDesk(salesperson.name, { from: day(params.get('from')), to: day(params.get('to')) }));
}
