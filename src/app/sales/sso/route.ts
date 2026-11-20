import { type NextRequest, NextResponse } from 'next/server';
import { readSalesPass } from '@/lib/sales-pass';
import { HEMPARSHWA_OS_URL, SALES_WORKSPACE_ROUTE, setSalespersonSession } from '@/lib/salesperson-auth';
import { getSalespersonByEmployeeNumber } from '@/lib/salespeople';

// Arrival from Hemparshwa OS: a valid sales pass opens that person's calling desk; anything else goes back to OS sign-in.
export async function GET(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host')?.split(',')[0].trim() || req.headers.get('host') || req.nextUrl.host;
  const origin = `${proto}://${host}`;
  const code = readSalesPass(req.nextUrl.searchParams.get('t'), origin);
  const salesperson = code ? getSalespersonByEmployeeNumber(code) : undefined;
  if (!salesperson) return NextResponse.redirect(HEMPARSHWA_OS_URL, { status: 303, headers: { 'Cache-Control': 'no-store' } });
  await setSalespersonSession(salesperson);
  return NextResponse.redirect(new URL(SALES_WORKSPACE_ROUTE, origin), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
