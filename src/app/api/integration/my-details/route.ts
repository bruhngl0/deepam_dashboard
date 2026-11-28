import { getEmployee } from '@/lib/hr/employees';
import { isHemparshwaAuthorized, myDetails } from '@/lib/integration/my-details';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?code=DBYA0003 → that employee's own details (lib/integration/my-details.ts), for Hemparshwa OS → Settings. */
export async function GET(request: Request) {
  if (!isHemparshwaAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const code = (new URL(request.url).searchParams.get('code') ?? '').trim().toUpperCase();
  try {
    const e = await getEmployee(code);
    if (!e) return Response.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return Response.json(myDetails(e), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('integration/my-details', error);
    return Response.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
