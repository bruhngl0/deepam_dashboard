import { applyAsPartner } from '@/lib/partners/store';
import { CORS, readJson } from '../cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** `{ fullName, contact, email, category, city, consent: true }` → `{ ok, existing? }` or `{ ok: false, error }`. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return Response.json({ ok: false, error: 'Expected a JSON object.' }, { status: 400, headers: CORS });
  try {
    const result = await applyAsPartner((key) => body[key]);
    if (result.kind === 'invalid') return Response.json({ ok: false, error: result.message }, { status: 422, headers: CORS });
    return Response.json({ ok: true, existing: result.kind === 'existing' }, { headers: CORS });
  } catch (error) {
    console.error('[partners] application not saved', error);
    return Response.json({ ok: false, error: 'Unable to save your application. Please try again.' }, { status: 500, headers: CORS });
  }
}
