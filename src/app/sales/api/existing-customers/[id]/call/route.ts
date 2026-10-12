import { getAuthenticatedSalesperson } from '@/lib/salesperson-auth';
import { OUTCOMES, STORES, nowLocal } from '@/lib/marketing/local';
import { logExistingCustomerCall } from '@/lib/marketing/existing-customer-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const salesperson = await getAuthenticatedSalesperson();
  if (!salesperson) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number((await params).id);
  const body = await request.json().catch(() => null) as { outcome?: unknown; note?: unknown; preferredStore?: unknown; product?: unknown; category?: unknown; followupDue?: unknown } | null;
  const outcome = typeof body?.outcome === 'string' ? body.outcome : '';
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : '';
  const preferredStore = typeof body?.preferredStore === 'string' ? body.preferredStore.trim() : '';
  const product = typeof body?.product === 'string' ? body.product.trim().slice(0, 200) : '';
  const category = typeof body?.category === 'string' ? body.category.trim().slice(0, 200) : '';
  const followupDue = typeof body?.followupDue === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.followupDue) ? body.followupDue : null;
  if (!Number.isSafeInteger(id) || id < 1 || !(OUTCOMES as readonly string[]).includes(outcome)) {
    return Response.json({ error: 'Invalid call outcome.' }, { status: 422 });
  }
  if (outcome === 'Connected / interested' && !(STORES as readonly string[]).includes(preferredStore)) return Response.json({ error: 'Choose the preferred store.' }, { status: 422 });
  if (outcome === 'Connected / interested' && preferredStore === 'Online' && (!product || !category)) return Response.json({ error: 'Enter product and category for an Online customer.' }, { status: 422 });
  if (followupDue && followupDue <= nowLocal().slice(0, 16)) return Response.json({ error: 'Choose a future follow-up time.' }, { status: 422 });
  const saved = await logExistingCustomerCall({ id, salesperson: salesperson.name, outcome, note, calledAt: nowLocal(), preferredStore, product, category, followupDue });
  return saved ? Response.json({ saved: true }) : Response.json({ error: 'Customer is not in your active queue.' }, { status: 409 });
}
