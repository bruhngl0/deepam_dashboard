/**
 * Master-sheet import — commit. The destructive path.
 *
 * This deletes every lead touch, follow-up, walk-in submission, campaign and
 * lead import batch, then reloads them from the uploaded workbook — see the
 * header of `scripts/import-master-sheet.ts` for exactly what that costs.
 * `commitMasterSheet` (src/lib/import/master-sheet.ts) is the same function
 * the CLI's `--commit` flag calls; nothing about the transaction differs here.
 *
 * ── Two gates, not one ───────────────────────────────────────────────────────
 * Auth now protects this route two ways: `proxy.ts` redirects a signed-out
 * browser before the request ever reaches here, and `requireApiUser()` below
 * checks again — the proxy is documented by Next.js itself as an optimistic
 * check, not the authorisation boundary, so a route this destructive does not
 * rely on it alone.
 *
 * `ALLOW_MASTER_SHEET_IMPORT` stays as a second, independent gate on top of
 * both. It predates auth (D-89) and was the only barrier before it existed;
 * now it is defense in depth — a Vercel environment variable that has to be
 * deliberately set, so this route can't fire just because someone's session
 * cookie happened to be valid and they clicked the wrong button.
 */

import { commitMasterSheet } from '@/lib/import/master-sheet';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  if (process.env.ALLOW_MASTER_SHEET_IMPORT !== 'true') {
    return Response.json(
      {
        error:
          'Import commit is disabled. This deletes and reloads the entire lead layer — set ' +
          'ALLOW_MASTER_SHEET_IMPORT=true in the Vercel project to enable it.',
      },
      { status: 403 },
    );
  }

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
    const summary = await commitMasterSheet(buffer, file.name, auth);
    return Response.json(summary);
  } catch (e) {
    // The transaction rolls itself back on any error (D-60) — there is no
    // partial state to report here, just what went wrong.
    return Response.json(
      { error: e instanceof Error ? e.message : 'Import failed.' },
      { status: 500 },
    );
  }
}
