/**
 * Barcode-wise sales import — commit.
 *
 * Upserts on `(voucher_date_raw, voucher_no_raw, barcode)`. No `ALLOW_*`
 * gate, same reasoning as `preview/route.ts`.
 */

import { previewSaleLineItemsImport, commitSaleLineItemsImport } from '@/lib/import/sale-line-items';
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
    const preview = await previewSaleLineItemsImport(buffer, file.name);
    const summary = await commitSaleLineItemsImport(preview, auth);
    return Response.json(summary);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Import failed.' },
      { status: 500 },
    );
  }
}
