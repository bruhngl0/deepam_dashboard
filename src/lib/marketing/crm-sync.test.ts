import { describe, expect, it } from 'vitest';
import { crmCampaignName, crmChannel } from './crm-sync-mapping';

describe('Marketing Intelligence CRM bridge', () => {
  it('maps sheet sources to canonical CRM channels', () => {
    expect(crmChannel('Meta ads')).toBe('meta');
    expect(crmChannel('Instagram DM')).toBe('meta');
    expect(crmChannel('Google ads')).toBe('google');
    expect(crmChannel('WhatsApp')).toBe('whatsapp');
    expect(crmChannel('Referral')).toBe('other');
  });

  it('keeps campaign identity in the canonical campaign name', () => {
    expect(crmCampaignName({ source: 'Google ads', campaignId: 'Festive 2026', at: '2026-10-10', cost: null }))
      .toBe('Marketing — Google Ads — Festive 2026');
    expect(crmCampaignName({ source: 'Meta ads', campaignId: '', at: '2026-10-10', cost: null }))
      .toBe('Marketing Sheets — Meta');
  });
});
