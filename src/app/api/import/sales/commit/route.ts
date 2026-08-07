/**
 * Sales report import — commit.
 *
 * Additive and idempotent (D-04, D-59): every bill lands under its own
 * import batch, `voucher_no` dedupes, and re-uploading the same report is a
 * harmless no-op. No `ALLOW_*` gate — see `preview/route.ts` for why this
 * route doesn't carry one the way master-sheet's does.
 */

import { previewSalesImport, commitSalesImport } from '@/lib/import/sales';
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
    // Re-parsed here, not trusted from the client — same reasoning as every
    // other commit route in this app.
    const preview = await previewSalesImport(buffer, file.name);
    const summary = await commitSalesImport(preview, auth);
    return Response.json(summary);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Import failed.' },
      { status: 500 },
    );
  }
}
