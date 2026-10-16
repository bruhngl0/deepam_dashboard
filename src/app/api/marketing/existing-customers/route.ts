import { requireApiUser } from '@/lib/auth';
import { EXHIBITION_LIST_KEY, EXHIBITION_LIST_NAME, ONLINE_LIST_KEY, ONLINE_LIST_NAME } from '@/lib/marketing/existing-customer-import';
import { EXISTING_CUSTOMER_VIEWS, existingCustomerKpis, existingCustomerPage, existingCustomerStores, type ExistingCustomerView } from '@/lib/marketing/existing-customer-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const page = Number(params.get('page') ?? 0);
  const search = (params.get('search') ?? '').trim().slice(0, 100);
  const view = (params.get('view') ?? 'all') as ExistingCustomerView;
  const online = params.get('list') === 'online';
  const listKey = online ? ONLINE_LIST_KEY : EXHIBITION_LIST_KEY;
  if (!Number.isSafeInteger(page) || page < 0) return Response.json({ error: 'Invalid page.' }, { status: 400 });
  if (!EXISTING_CUSTOMER_VIEWS.includes(view)) return Response.json({ error: 'Invalid view.' }, { status: 400 });
  const day = (key: string) => (params.get(key) ?? '').trim();
  const filters = { from: day('from'), to: day('to'), store: (params.get('store') ?? '').trim().slice(0, 100) };
  if ([filters.from, filters.to].some(value => value && !DAY.test(value))) return Response.json({ error: 'Invalid date.' }, { status: 400 });
  const [kpis, list, stores] = await Promise.all([existingCustomerKpis(filters, listKey), existingCustomerPage(view, search, page, filters, listKey), existingCustomerStores(listKey)]);
  return Response.json({
    listKey,
    listName: online ? ONLINE_LIST_NAME : EXHIBITION_LIST_NAME,
    total: kpis.total,
    assigned: kpis.assigned,
    unassigned: kpis.total - kpis.assigned,
    kpis,
    stores,
    view,
    filtered: list.filtered,
    page,
    pageSize: list.pageSize,
    rows: list.rows,
  });
}
