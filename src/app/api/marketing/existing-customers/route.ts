import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { marketingCallListContacts } from '@/db/schema';
import { requireApiUser } from '@/lib/auth';
import { EXHIBITION_LIST_KEY, EXHIBITION_LIST_NAME } from '@/lib/marketing/existing-customer-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const page = Number(params.get('page') ?? 0);
  const search = (params.get('search') ?? '').trim().slice(0, 100);
  if (!Number.isSafeInteger(page) || page < 0) return Response.json({ error: 'Invalid page.' }, { status: 400 });
  const match = search ? or(
    ilike(marketingCallListContacts.name, `%${search}%`),
    ilike(marketingCallListContacts.phone, `%${search.replace(/\s/g, '')}%`),
    ilike(marketingCallListContacts.sourceCustomerId, `%${search}%`),
    ilike(marketingCallListContacts.branch, `%${search}%`),
    ilike(marketingCallListContacts.assignedTo, `%${search}%`),
  ) : undefined;
  const where = match ? and(eq(marketingCallListContacts.listKey, EXHIBITION_LIST_KEY), match) : eq(marketingCallListContacts.listKey, EXHIBITION_LIST_KEY);
  const base = eq(marketingCallListContacts.listKey, EXHIBITION_LIST_KEY);
  const [[summary], [filtered], rows] = await Promise.all([
    db.select({ total: count(), assigned: sql<number>`count(*) filter (where ${marketingCallListContacts.assignedTo} is not null)::int` }).from(marketingCallListContacts).where(base),
    db.select({ total: count() }).from(marketingCallListContacts).where(where),
    db.select({ id: marketingCallListContacts.id, sourceCustomerId: marketingCallListContacts.sourceCustomerId, name: marketingCallListContacts.name, phone: marketingCallListContacts.phone, branch: marketingCallListContacts.branch, city: marketingCallListContacts.city, assignedTo: marketingCallListContacts.assignedTo })
      .from(marketingCallListContacts).where(where).orderBy(asc(marketingCallListContacts.id)).limit(50).offset(page * 50),
  ]);
  return Response.json({
    listKey: EXHIBITION_LIST_KEY,
    listName: EXHIBITION_LIST_NAME,
    total: summary.total,
    assigned: Number(summary.assigned),
    unassigned: summary.total - Number(summary.assigned),
    filtered: filtered.total,
    page,
    pageSize: 50,
    rows,
  });
}
