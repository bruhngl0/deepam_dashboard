import { requireApiUser } from '@/lib/auth';
import { EXHIBITION_LIST_KEY, EXHIBITION_LIST_NAME } from '@/lib/marketing/existing-customer-import';
import { EXISTING_CUSTOMER_VIEWS, existingCustomerKpis, existingCustomerPage, type ExistingCustomerView } from '@/lib/marketing/existing-customer-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const page = Number(params.get('page') ?? 0);
  const search = (params.get('search') ?? '').trim().slice(0, 100);
  const view = (params.get('view') ?? 'all') as ExistingCustomerView;
  if (!Number.isSafeInteger(page) || page < 0) return Response.json({ error: 'Invalid page.' }, { status: 400 });
  if (!EXISTING_CUSTOMER_VIEWS.includes(view)) return Response.json({ error: 'Invalid view.' }, { status: 400 });
  const [kpis, list] = await Promise.all([existingCustomerKpis(), existingCustomerPage(view, search, page)]);
  return Response.json({
    listKey: EXHIBITION_LIST_KEY,
    listName: EXHIBITION_LIST_NAME,
    total: kpis.total,
    assigned: kpis.assigned,
    unassigned: kpis.total - kpis.assigned,
    kpis,
    view,
    filtered: list.filtered,
    page,
    pageSize: list.pageSize,
    rows: list.rows,
  });
}
