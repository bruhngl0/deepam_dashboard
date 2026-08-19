/**
 * Vendor stock ledger import — commit.
 *
 * Upserts on `(barcode, period_from, period_to)` — re-uploading the same
 * period is a correction, not a duplicate. No `ALLOW_*` gate, same reasoning
 * as `preview/route.ts`.
 */

import { previewVendorStockImport, commitVendorStockImport } from '@/lib/import/vendor-stock';
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
    const preview = await previewVendorStockImport(buffer, file.name);
    const summary = await commitVendorStockImport(preview, auth);
    return Response.json(summary);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Import failed.' },
      { status: 500 },
    );
  }
}
