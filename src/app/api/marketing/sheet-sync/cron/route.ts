/**
 * Scheduled trigger for the Google Sheet import, for hosts where an
 * in-process timer cannot be relied on (serverless, or a container whose CPU
 * is throttled between requests). Point any scheduler at this URL with
 * `Authorization: Bearer $CRON_SECRET`; Vercel Cron sends that header itself.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runSheetSync } from '@/lib/marketing/sheet-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { state, status } = await runSheetSync();
  return NextResponse.json({ state, status }, { status: state === 'failed' ? 502 : 200 });
}

export const GET = run;
export const POST = run;
