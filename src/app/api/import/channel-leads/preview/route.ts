/**
 * Bulk channel lead import — preview. Additive (see
 * `lib/import/channel-leads.ts`), so no ALLOW_* kill-switch, same as the
 * Instagram/Meta and sales preview routes.
 *
 * The response carries counts only, never `preview.rows` — those hold every
 * phone number, name and email in the file.
 */

import { previewChannelLeads, type BulkLeadChannel } from '@/lib/import/channel-leads';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';

const VALID_CHANNELS: BulkLeadChannel[] = ['meta', 'whatsapp', 'google', 'other'];

export interface ChannelLeadsPreviewResponse {
  channel: BulkLeadChannel;
  fileName: string;
  sheetName: string;
  campaignName: string;
  rawRows: number;
  duplicates: number;
  rejected: number;
  rejectedByCode: { code: string; n: number }[];
  newCustomers: number;
  existingCustomers: number;
  alreadyImported: boolean;
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  const form = await request.formData();
  const file = form.get('file');
  const channel = form.get('channel');

  if (!(file instanceof File)) {
    return Response.json({ error: 'No file uploaded.' }, { status: 400 });
  }
  if (!file.name.match(/\.xlsx?$/i)) {
    return Response.json({ error: 'Expected an .xlsx or .xls workbook.' }, { status: 400 });
  }
  if (typeof channel !== 'string' || !VALID_CHANNELS.includes(channel as BulkLeadChannel)) {
    return Response.json(
      { error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const preview = await previewChannelLeads(buffer, file.name, channel as BulkLeadChannel);

    const rejectedByCode = new Map<string, number>();
    for (const r of preview.rejected) {
      rejectedByCode.set(r.errorCode, (rejectedByCode.get(r.errorCode) ?? 0) + 1);
    }

    const body: ChannelLeadsPreviewResponse = {
      channel: preview.channel,
      fileName: preview.fileName,
      sheetName: preview.sheetName,
      campaignName: preview.campaignName,
      rawRows: preview.rawRows,
      duplicates: preview.duplicates,
      rejected: preview.rejected.length,
      rejectedByCode: [...rejectedByCode.entries()]
        .map(([code, n]) => ({ code, n }))
        .sort((a, b) => b.n - a.n),
      newCustomers: preview.newCustomers,
      existingCustomers: preview.existingCustomers,
      alreadyImported: preview.alreadyImported,
    };
    return Response.json(body);
  } catch (e) {
    // Malformed workbook or no phone column — the file is the problem, not
    // the server, hence 422 not 500.
    return Response.json(
      { error: e instanceof Error ? e.message : 'Could not parse the workbook.' },
      { status: 422 },
    );
  }
}
