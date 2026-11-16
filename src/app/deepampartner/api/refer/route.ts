import { DECLINE_MESSAGE } from '@/lib/partners/constants';
import { registerReferral } from '@/lib/partners/store';
import { CORS, readJson } from '../cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * `{ partner: "DPR-00001", fullName, contact, occasion, store: "MG_ROAD" | "JAYANAGAR", appointmentDate: "YYYY-MM-DD", consent: true }`
 * → `{ ok: true }`, or `{ ok: false, error, declined? }` (declined: the number cannot be referred; show `error` as is).
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return Response.json({ ok: false, error: 'Expected a JSON object.' }, { status: 400, headers: CORS });
  try {
    const result = await registerReferral(String(body.partner ?? ''), (key) => body[key]);
    if (result.kind === 'inactive') return Response.json({ ok: false, error: 'This partner link is no longer active.' }, { status: 404, headers: CORS });
    if (result.kind === 'invalid') return Response.json({ ok: false, error: result.message }, { status: 422, headers: CORS });
    if (result.kind === 'declined') return Response.json({ ok: false, declined: true, error: DECLINE_MESSAGE[result.reason] }, { status: 409, headers: CORS });
    return Response.json({ ok: true }, { headers: CORS });
  } catch (error) {
    console.error('[partners] referral not saved', error);
    return Response.json({ ok: false, error: 'Unable to save your registration. Please try again.' }, { status: 500, headers: CORS });
  }
}
