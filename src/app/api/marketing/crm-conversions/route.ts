/** Copies conversions (CRM bills from marketing leads) into Marketing Intelligence. */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { syncConversionsFromCrm } from '@/lib/marketing/crm-conversions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json(await syncConversionsFromCrm());
  } catch (error) {
    console.error('marketing/crm-conversions', error);
    return NextResponse.json({ error: 'Could not sync from Deepam CRM. Try again.' }, { status: 500 });
  }
}
