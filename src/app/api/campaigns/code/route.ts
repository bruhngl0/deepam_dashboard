/**
 * Set a campaign's pre-given Campaign ID. Campaigns are created by the
 * importers, so the ID is attached afterwards from the campaign table.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaigns } from '@/db/schema';
import { requireApiUser } from '@/lib/auth';
import { parseCampaignCode } from '@/lib/campaign-code';

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const campaignId = Number(body?.campaignId);
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    return Response.json({ error: 'campaignId must be a positive integer.' }, { status: 400 });
  }
  const campaignCode = parseCampaignCode(body?.campaignCode);
  if (!campaignCode) {
    return Response.json(
      { error: 'Campaign ID must be 1–40 letters, digits, "-", "_" or "/".' },
      { status: 400 },
    );
  }

  try {
    const [row] = await db
      .update(campaigns)
      .set({ campaignCode })
      .where(eq(campaigns.id, campaignId))
      .returning({ id: campaigns.id, campaignCode: campaigns.campaignCode });
    if (!row) return Response.json({ error: 'Campaign not found.' }, { status: 404 });
    return Response.json(row);
  } catch (e) {
    if ((e as { code?: string })?.code === '23505' || String((e as Error)?.cause ?? e).includes('campaigns_campaign_code_unique')) {
      return Response.json({ error: `Campaign ID ${campaignCode} is already used by another campaign.` }, { status: 409 });
    }
    throw e;
  }
}
