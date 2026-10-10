/**
 * The shared Marketing Intelligence dataset.
 *
 * GET pages through it (`part=stamp|leads|sales`) so a large lead list never
 * has to fit in one response; clients poll `stamp` and reload only when it
 * moves. POST writes changed leads and new bills; see `lib/marketing/store.ts`
 * for why a write can come back as a conflict.
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { datasetStamp, isLead, isSale, leadPage, salePage, saveChanges, type LeadWrite } from '@/lib/marketing/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEAD_PAGE = 1000;
const SALE_PAGE = 5000;
const MAX_BATCH = 500;

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const after = Number(params.get('after') ?? 0);
  if (!Number.isSafeInteger(after) || after < 0) return NextResponse.json({ error: 'Invalid cursor.' }, { status: 400 });
  const part = params.get('part');
  if (part === 'stamp') return NextResponse.json({ stamp: await datasetStamp() });
  if (part === 'leads') return NextResponse.json(await leadPage(after, LEAD_PAGE, true));
  if (part === 'sales') return NextResponse.json(await salePage(after, SALE_PAGE));
  return NextResponse.json({ error: 'part must be stamp, leads or sales.' }, { status: 400 });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null) as { leads?: unknown; sales?: unknown } | null;
  const leads = Array.isArray(body?.leads) ? body.leads as LeadWrite[] : [];
  const sales = Array.isArray(body?.sales) ? body.sales : [];
  if (!leads.length && !sales.length) return NextResponse.json({ error: 'Nothing to save.' }, { status: 422 });
  if (leads.length > MAX_BATCH || sales.length > MAX_BATCH) return NextResponse.json({ error: `Send at most ${MAX_BATCH} leads and ${MAX_BATCH} bills per request.` }, { status: 422 });
  if (leads.some((w) => !w || !isLead(w.lead) || !Number.isSafeInteger(w.version) || w.version < 0) || new Set(leads.map((w) => w.lead.id)).size !== leads.length) {
    return NextResponse.json({ error: 'Invalid lead record.' }, { status: 422 });
  }
  if (!sales.every(isSale)) return NextResponse.json({ error: 'Invalid bill record.' }, { status: 422 });
  return NextResponse.json(await saveChanges(leads, sales));
}
