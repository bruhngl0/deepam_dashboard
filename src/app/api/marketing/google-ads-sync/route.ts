/**
 * Loads Google ad spend from the Google Ads API (lib/marketing/google-ads-spend),
 * replacing saved Google spend. Called hourly by an EventBridge schedule
 * (scripts/aws/google-ads-spend-schedule.sh) with `Authorization: Bearer $CRON_SECRET`.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { syncGoogleAdsSpend } from '@/lib/marketing/google-ads-spend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await syncGoogleAdsSpend();
    delete result.rows; // the summary only, not every campaign-day
    return NextResponse.json(result, { status: result.state === 'off' ? 503 : 200 });
  } catch (error) {
    console.error('[google ads spend]', error);
    return NextResponse.json({ state: 'failed', error: error instanceof Error ? error.message : 'Google Ads sync failed.' }, { status: 502 });
  }
}
