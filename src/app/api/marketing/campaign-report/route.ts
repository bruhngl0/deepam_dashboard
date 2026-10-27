/** One campaign's KPIs (GET ?name=), and its event venue, dates and exhibition expense (PUT). */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { parseSettings } from '@/lib/marketing/campaign-report';
import { campaignReport, saveCampaignSettings } from '@/lib/marketing/campaign-report-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const name = new URL(request.url).searchParams.get('name')?.trim();
  if (!name) return NextResponse.json({ error: 'Choose a campaign.' }, { status: 400 });
  try {
    const report = await campaignReport(name);
    if (!report) return NextResponse.json({ error: 'No leads carry this campaign.' }, { status: 404 });
    return NextResponse.json(report);
  } catch (error) {
    console.error('marketing/campaign-report', error);
    return NextResponse.json({ error: 'Could not load this campaign. Try again.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null) as { name?: unknown; settings?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Choose a campaign.' }, { status: 400 });
  const settings = parseSettings(body?.settings);
  if (typeof settings === 'string') return NextResponse.json({ error: settings }, { status: 400 });
  try {
    await saveCampaignSettings(name, settings);
    const report = await campaignReport(name);
    return report ? NextResponse.json(report) : NextResponse.json({ error: 'No leads carry this campaign.' }, { status: 404 });
  } catch (error) {
    console.error('marketing/campaign-report', error);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });
  }
}
