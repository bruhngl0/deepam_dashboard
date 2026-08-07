/**
 * Instagram/Meta leads import — preview. Additive, not destructive (unlike
 * master-sheet's commit route), so there's no ALLOW_* kill-switch here — the
 * worst case is adding real people who really are in the uploaded file. See
 * `lib/import/instagram-leads.ts` for what this does and doesn't touch.
 *
 * Still requires a signed-in user: `proxy.ts`'s redirect is optimistic by
 * design, not the boundary (D-93).
 *
 * The response carries per-sheet counts only, never the parsed rows — those
 * hold every phone number, name and email in the file, and a preview has no
 * reason to put that on the wire.
 */

import { previewInstagramLeadsImport } from '@/lib/import/instagram-leads';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';

export interface InstagramLeadsPreviewResponse {
  fileName: string;
  sheets: {
    sheet: string;
    dataRows: number;
    valid: number;
    uniquePhones: number;
    duplicatesInFile: number;
    rejected: number;
    rejectedByCode: { code: string; n: number }[];
    newCustomers: number;
    existingCustomers: number;
    alreadyImported: boolean;
  }[];
  distinctPeople: number;
}

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
    const preview = await previewInstagramLeadsImport(buffer, file.name);
    const body: InstagramLeadsPreviewResponse = {
      fileName: preview.fileName,
      sheets: preview.sheets.map(({ _preview, ...rest }) => rest),
      distinctPeople: preview.distinctPeople,
    };
    return Response.json(body);
  } catch (e) {
    // Malformed workbook, no phone column, or the combined-workbook guard —
    // a 422 with the parser's own message, not a 500: the file is the
    // problem, not the server.
    return Response.json(
      { error: e instanceof Error ? e.message : 'Could not parse the workbook.' },
      { status: 422 },
    );
  }
}
