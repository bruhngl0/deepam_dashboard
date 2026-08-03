/**
 * Master-sheet import — preview.
 *
 * Parsing only, no database access, so this route needs no destructive-action
 * gate: nothing it does can be undone because nothing it does is written
 * anywhere. See `commit/route.ts` for the route that actually changes data.
 * It still requires a signed-in user (`requireApiUser`) — `proxy.ts` already
 * covers this path, but that check is optimistic by design, and a workbook
 * upload is exactly the kind of request a signed-out `curl` shouldn't get an
 * answer from even when the answer is "just counts."
 *
 * The response is a summary, not the parsed rows — `SheetResult.rows` carries
 * every phone number, name and email in the sheet, and a preview endpoint has
 * no reason to put that on the wire. The client re-sends the file to `commit`
 * rather than the server holding an uploaded file in memory between requests,
 * which would need session state this route has no other reason to carry.
 */

import { previewMasterSheet } from '@/lib/import/master-sheet';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';

export interface SheetSummary {
  sheet: string;
  channel: string;
  rawRows: number;
  validRows: number;
  distinctRows: number;
  duplicates: number;
  rejected: number;
  rejectedByCode: { code: string; n: number }[];
  flagged: number;
}

export interface MasterSheetPreviewResponse {
  fileName: string;
  sheets: SheetSummary[];
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

  let preview: ReturnType<typeof previewMasterSheet>;
  try {
    preview = previewMasterSheet(buffer);
  } catch (e) {
    // Malformed workbook / missing sheet or column — a 422 with the parser's
    // own message, not a 500: the file is the problem, not the server.
    return Response.json(
      { error: e instanceof Error ? e.message : 'Could not parse the workbook.' },
      { status: 422 },
    );
  }

  const sheets: SheetSummary[] = preview.results.map((r) => {
    const rejectedByCode = new Map<string, number>();
    for (const rej of r.rejected) {
      rejectedByCode.set(rej.errorCode, (rejectedByCode.get(rej.errorCode) ?? 0) + 1);
    }
    return {
      sheet: r.spec.sheet,
      channel: r.spec.channel,
      rawRows: r.rawRows,
      validRows: r.rows.length + r.duplicates,
      distinctRows: r.rows.length,
      duplicates: r.duplicates,
      rejected: r.rejected.length,
      rejectedByCode: [...rejectedByCode.entries()]
        .map(([code, n]) => ({ code, n }))
        .sort((a, b) => b.n - a.n),
      flagged: r.flagged,
    };
  });

  const body: MasterSheetPreviewResponse = {
    fileName: file.name,
    sheets,
    distinctPeople: preview.distinctPeople,
  };
  return Response.json(body);
}
