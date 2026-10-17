/** Store visit and Virtual calls leads and their conversions, for the marketing team dashboard. */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { leadTypeConversions } from '@/lib/marketing/lead-type-conversions-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json(await leadTypeConversions());
  } catch (error) {
    console.error('marketing/lead-type-conversions', error);
    return NextResponse.json({ error: 'Could not load store visit and virtual call conversions. Try again.' }, { status: 500 });
  }
}
