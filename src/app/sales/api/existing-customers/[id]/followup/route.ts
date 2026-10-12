import { getAuthenticatedSalesperson } from '@/lib/salesperson-auth';
import { completeExistingCustomerFollowup } from '@/lib/marketing/existing-customer-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const salesperson = await getAuthenticatedSalesperson();
  if (!salesperson) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: 'Invalid customer.' }, { status: 422 });
  const saved = await completeExistingCustomerFollowup(id, salesperson.name);
  return saved ? Response.json({ saved: true }) : Response.json({ error: 'Follow-up is not active.' }, { status: 409 });
}
