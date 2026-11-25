import { requireApiUser } from '@/lib/auth';
import { addDrivers, parseDriverLines } from '@/lib/marketing/driver-desk';
import { driverDeskResponse } from '@/lib/marketing/driver-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  return driverDeskResponse(request, null);
}

/** Adds drivers from pasted "Name - number" lines. */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.slice(0, 200_000) : '';
  const { drivers, skipped } = parseDriverLines(text);
  if (!drivers.length) return Response.json({ error: 'No "Name - number" lines found.', skipped }, { status: 422 });
  const result = await addDrivers(drivers, 'Marketing');
  return Response.json({ ...result, skipped });
}
