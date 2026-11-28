import { type NextRequest, NextResponse } from 'next/server';
import { chatPass } from '@/lib/sales-pass';
import { getDeskCaller, HEMPARSHWA_OS_URL, SALES_LOGIN_ROUTE } from '@/lib/salesperson-auth';

/*
 * The desk's "Team chat" button (owner, 28 Nov 2026): Team Chat lives in Hemparshwa OS. This signs a one-minute pass
 * for the signed-in desk person (role "chat", their employee number, the OS origin) under ADMIN_SSO_SECRET, which OS
 * /chat/sso accepts for chat pages only; every other OS page still sends them back to their desk.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const caller = await getDeskCaller();
  const secret = process.env.ADMIN_SSO_SECRET;
  const os = new URL(process.env.HEMPARSHWA_URL || HEMPARSHWA_OS_URL).origin;
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (!caller || !secret || secret.length < 32) return NextResponse.redirect(new URL(SALES_LOGIN_ROUTE, req.nextUrl), { status: 303, headers });
  return NextResponse.redirect(`${os}/chat/sso?${new URLSearchParams({ t: chatPass(caller.employeeNumber, os, secret) })}`, { status: 303, headers });
}
