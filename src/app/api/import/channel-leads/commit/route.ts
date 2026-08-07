/**
 * Bulk channel lead import — commit.
 *
 * Additive only (see `lib/import/channel-leads.ts`): upserts customers
 * (fill-blanks-only, D-24) and inserts new lead_touches under the channel's
 * persistent 'Master Sheet — <Channel>' campaign, `ON CONFLICT DO NOTHING`.
 * Nothing is ever deleted, so no `ALLOW_*` gate — the worst case is a
 * customer being added a second time as a no-op.
 */

import { previewChannelLeads, commitChannelLeads, type BulkLeadChannel } from '@/lib/import/channel-leads';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_CHANNELS: BulkLeadChannel[] = ['meta', 'whatsapp', 'google', 'other'];

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
    // Re-parsed here rather than trusting a client-supplied preview payload —
    // same reasoning as every other commit route in this app: the file is
    // the only thing the server should ever act on.
    const preview = await previewChannelLeads(buffer, file.name, channel as BulkLeadChannel);
    const summary = await commitChannelLeads(preview, auth);
    return Response.json(summary);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Import failed.' },
      { status: 500 },
    );
  }
}
