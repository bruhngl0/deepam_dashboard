import { registerVisit } from '../register';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The same form lives on deepam.com and posts here from the browser. It is as
// public as the form on this app, and carries no cookies, so any origin may call it.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ ok: false, error: 'Expected a JSON object.' }, { status: 400, headers: CORS });
  }
  try {
    if ((await registerVisit((key) => body[key])) === 'invalid') {
      return Response.json({ ok: false, error: 'Please enter your full name and a contact number with at least 10 digits.' }, { status: 422, headers: CORS });
    }
    return Response.json({ ok: true }, { headers: CORS });
  } catch (error) {
    console.error('[exhb] registration not saved', error);
    return Response.json({ ok: false, error: 'Unable to save your registration. Please try again.' }, { status: 500, headers: CORS });
  }
}
