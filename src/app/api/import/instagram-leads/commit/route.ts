/**
 * Instagram/Meta leads import — commit.
 *
 * Additive only (see `lib/import/instagram-leads.ts`): upserts customers
 * (fill-blanks-only, D-24) and inserts new lead_touches under the existing
 * 'Master Sheet — Meta' campaign, `ON CONFLICT DO NOTHING`. WhatsApp, Google
 * Ads and Others are never touched, and nothing is ever deleted — unlike
 * master-sheet's commit route, so no `ALLOW_*` gate and no confirm-text UI:
 * the worst case here is a customer being added a second time as a no-op,
 * not the lead layer being wiped.
 */

import { previewInstagramLeadsImport, commitInstagramLeadsImport } from '@/lib/import/instagram-leads';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return Response.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  if (!file.name.match(/\.xlsx?$/i)) {
    return Response.json({ error: 'Expected an .xlsx or .xls workbook.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    // Re-parsed here rather than trusting a client-supplied preview payload —
    // same reasoning as master-sheet's commit route: the file is the only
    // thing the server should ever act on.
    const preview = await previewInstagramLeadsImport(buffer, file.name);
    const summary = await commitInstagramLeadsImport(preview, auth);
    return Response.json(summary);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Import failed.' },
      { status: 500 },
    );
  }
}
