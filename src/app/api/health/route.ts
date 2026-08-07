/**
 * Container health check — App Runner (and anything else load-balancing this
 * image) needs an endpoint that answers without Clerk credentials, since a
 * health checker has none. Deliberately does not touch the database: this
 * confirms the Node process is alive and serving, not that Neon is reachable
 * — a transient DB blip should not make App Runner cycle the container.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}
