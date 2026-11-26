import { type NextRequest, NextResponse } from 'next/server';
import { deskPerson } from '@/lib/desk-access';
import { readSalesPassClaims } from '@/lib/sales-pass';
import { HEMPARSHWA_OS_URL, SALES_WORKSPACE_ROUTE, setSalespersonSession } from '@/lib/salesperson-auth';

/*
 * Arrival from Hemparshwa OS: a valid sales pass opens that person's desk; anything else goes back to OS sign-in.
 * The pass says which desk (Auth Control in the OS decides); an older pass without one falls back to the CRM's lists.
 */
export async function GET(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host')?.split(',')[0].trim() || req.headers.get('host') || req.nextUrl.host;
  const origin = `${proto}://${host}`;
  const claims = readSalesPassClaims(req.nextUrl.searchParams.get('t'), origin);
  const person = claims ? deskPerson({ employeeNumber: claims.sub, desk: claims.desk ?? undefined, name: claims.name ?? undefined }) : undefined;
  if (!claims || !person) return NextResponse.redirect(HEMPARSHWA_OS_URL, { status: 303, headers: { 'Cache-Control': 'no-store' } });
  await setSalespersonSession(person, claims.desk ?? undefined, claims.desk ? person.name : undefined);
  return NextResponse.redirect(new URL(SALES_WORKSPACE_ROUTE, origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
