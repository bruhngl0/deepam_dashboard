import { getAuthenticatedSalesperson } from '@/lib/salesperson-auth';
import { nowLocal } from '@/lib/marketing/local';
import { claimLeads } from '@/lib/marketing/store';
import { claimRoutingFor } from '@/lib/marketing/sheet-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const salesperson = await getAuthenticatedSalesperson();
  if (!salesperson) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const claimedAt = nowLocal();
  const routing = claimRoutingFor(salesperson.name, claimedAt.slice(0, 10));
  const ids = await claimLeads(salesperson.name, claimedAt, 10, routing);
  return Response.json({ claimed: ids.length, ids });
}
