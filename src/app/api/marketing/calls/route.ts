import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { marketingCalls } from '@/db/schema';
import { OUTCOMES } from '@/lib/marketing/local';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BATCH = 500;
const MAX_ROWS = 5000;
const IST = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

type Incoming = { id: string; leadId: string; leadName: string; phone: string; salesperson: string; outcome?: string; note?: string; at: string };

function parse(value: unknown): Incoming | null {
  const v = value as Record<string, unknown> | null;
  const str = (x: unknown, max: number) => (typeof x === 'string' && x.trim() && x.length <= max ? x.trim() : null);
  if (!v || typeof v !== 'object') return null;
  const id = str(v.id, 100), leadId = str(v.leadId, 100), leadName = str(v.leadName, 200), phone = str(v.phone, 40), salesperson = str(v.salesperson, 100), at = str(v.at, 30);
  if (!id || !leadId || !leadName || !phone || !salesperson || !at || !IST.test(at)) return null;
  const outcome = typeof v.outcome === 'string' && (OUTCOMES as readonly string[]).includes(v.outcome) ? v.outcome : undefined;
  const note = typeof v.note === 'string' ? v.note.slice(0, 2000) : '';
  return { id, leadId, leadName, phone, salesperson, outcome, note, at };
}

/** Idempotent: re-sending a call id is a no-op, so clients can safely resend everything. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const list: unknown[] = Array.isArray(body) ? body : body ? [body] : [];
  if (!list.length || list.length > MAX_BATCH) return NextResponse.json({ error: `Send 1-${MAX_BATCH} calls.` }, { status: 422 });
  const rows = list.map(parse);
  if (rows.some((r) => !r)) return NextResponse.json({ error: 'Invalid call record.' }, { status: 422 });
  const values = (rows as Incoming[]).map((r) => ({ id: r.id, leadId: r.leadId, leadName: r.leadName, phone: r.phone, salesperson: r.salesperson, outcome: r.outcome ?? null, note: r.note ?? '', calledAt: r.at }));
  const inserted = await db.insert(marketingCalls).values(values).onConflictDoNothing().returning({ id: marketingCalls.id });
  return NextResponse.json({ received: values.length, inserted: inserted.length });
}

export async function GET() {
  const rows = await db.select().from(marketingCalls).orderBy(desc(marketingCalls.calledAt)).limit(MAX_ROWS);
  return NextResponse.json({ calls: rows.map((r) => ({ id: r.id, at: r.calledAt.replace(' ', 'T'), salesperson: r.salesperson, outcome: r.outcome ?? '', note: r.note, leadId: r.leadId, name: r.leadName, phone: r.phone })) });
}
