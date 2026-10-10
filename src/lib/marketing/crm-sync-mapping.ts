import type { BulkLeadChannel } from '@/lib/import/channel-leads';
import type { Acquisition } from './local';

const CHANNEL_LABEL: Record<BulkLeadChannel, string> = {
  meta: 'Meta',
  whatsapp: 'WhatsApp',
  google: 'Google Ads',
  other: 'Others',
};

export function crmChannel(source: string): BulkLeadChannel {
  if (source === 'Meta ads' || source === 'Instagram DM') return 'meta';
  if (source === 'Google ads') return 'google';
  if (source === 'WhatsApp') return 'whatsapp';
  return 'other';
}

export function crmCampaignName(acquisition: Acquisition): string {
  const channel = crmChannel(acquisition.source);
  const campaign = acquisition.campaignId.trim();
  return campaign
    ? `Marketing — ${CHANNEL_LABEL[channel]} — ${campaign}`.slice(0, 240)
    : `Marketing Sheets — ${CHANNEL_LABEL[channel]}`;
}
