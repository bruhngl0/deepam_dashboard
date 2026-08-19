/**
 * Existing-customer seed import — preview.
 *
 * Additive/upserting, not destructive — re-uploading a corrected export
 * upserts by phone rather than duplicating (D-59). No ALLOW_* kill-switch,
 * same reasoning as sales' preview route.
 *
 * The response carries summary figures only, never `preview.parsed.rows` —
 * those hold every customer's name, phone, email and city.
 */

import { previewExistingCustomersImport } from '@/lib/import/existing-customers';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

export interface ExistingCustomersPreviewResponse {
  fileName: string;
  sheetName: string;
  rowsTotal: number;
  withBillHistory: number;
  withoutBillHistory: number;
  uniquePhones: number;
  duplicatePhonesInFile: number;
  alreadyImported: boolean;
  rejectedByCode: { code: string; n: number }[];
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return Response.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  if (!file.name.match(/\.(csv|xlsx?)$/i)) {
    return Response.json({ error: 'Expected a .csv or .xlsx export.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const preview = await previewExistingCustomersImport(buffer, file.name);

    const rejectedByCode = new Map<string, number>();
    for (const r of preview.rejected) {
      rejectedByCode.set(r.errorCode, (rejectedByCode.get(r.errorCode) ?? 0) + 1);
    }

    const body: ExistingCustomersPreviewResponse = {
      fileName: preview.fileName,
      sheetName: preview.sheetName,
      rowsTotal: preview.summary.rowsTotal,
      withBillHistory: preview.summary.withBillHistory,
      withoutBillHistory: preview.summary.withoutBillHistory,
      uniquePhones: preview.summary.uniquePhones,
      duplicatePhonesInFile: preview.summary.duplicatePhonesInFile,
      alreadyImported: preview.summary.alreadyImported,
      rejectedByCode: [...rejectedByCode.entries()]
        .map(([code, n]) => ({ code, n }))
        .sort((a, b) => b.n - a.n),
    };
    return Response.json(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Could not parse the file.' },
      { status: 422 },
    );
  }
}
