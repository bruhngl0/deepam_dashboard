import { describe, expect, it } from 'vitest';
import { campaignKind, leadKind, summarizeLeadTypes, type LeadAcquisitionRow } from './lead-type-conversions';

const lead = (over: Partial<LeadAcquisitionRow>): LeadAcquisitionRow => ({
  phone: '+919000000001', date: '2026-09-01', source: 'Meta ads', campaignId: 'Meta | 0001 | 2026 | 09 | Storevisit', claimGroup: '', sheetTabs: [], ...over,
});

describe('leadKind', () => {
  it('reads Store visit from the campaign', () => {
    expect(leadKind(lead({}))).toBe('Store visit');
    expect(leadKind(lead({ campaignId: 'Google | 0001 | 2026 | 09 | Storevisit' }))).toBe('Store visit');
  });
  it('puts Virtual calls tabs, group or campaign ahead of Store visit', () => {
    expect(leadKind(lead({ sheetTabs: ['Virtual calls - Oct'] }))).toBe('Virtual calls');
    expect(leadKind(lead({ claimGroup: 'virtual-calls' }))).toBe('Virtual calls');
    expect(leadKind(lead({ campaignId: 'Meta | 0004 | 2026 | 09 | Virtual Shopping (Video)' }))).toBe('Virtual calls');
  });
  it('leaves exhibition and campaign-less leads out', () => {
    expect(leadKind(lead({ campaignId: 'Meta | 0009 | 2026 | 10 | BLVD Club Exhibition' }))).toBeNull();
    expect(leadKind(lead({ campaignId: '' }))).toBeNull();
  });
});

describe('summarizeLeadTypes', () => {
  it('counts a lead as converted only for bills on or after its date, once per phone', () => {
    const rows = [
      lead({ phone: '+919000000001', date: '2026-09-10' }),
      lead({ phone: '+919000000001', date: '2026-09-10', source: 'Google ads', campaignId: 'Google | 0001 | 2026 | 09 | Storevisit' }),
      lead({ phone: '+919000000002', date: '2026-09-20' }),
      lead({ phone: '+919000000003', date: '2026-09-25', sheetTabs: ['Virtual calls - SEP.'] }),
    ];
    const bills = [
      { phone: '+919000000001', invoice: 'A1', amount: 1000, date: '2026-09-12' },
      { phone: '+919000000001', invoice: 'A2', amount: 500, date: '2026-09-15' },
      { phone: '+919000000002', invoice: 'B1', amount: 900, date: '2026-09-19' },
    ];
    const { kinds: [storeVisit, virtualCalls] } = summarizeLeadTypes(rows, bills);
    expect(storeVisit.total.stats).toEqual({ leads: 2, converted: 1, bills: 2, sales: 1500, firstLead: '2026-09-10', lastLead: '2026-09-20' });
    expect(storeVisit.total.spend).toBeNull();
    expect(storeVisit.platforms.map((p) => [p.platform, p.stats.leads, p.stats.converted])).toEqual([['Meta ads', 2, 1], ['Google ads', 1, 1]]);
    expect(virtualCalls.total.stats).toMatchObject({ leads: 1, converted: 0, bills: 0, sales: 0 });
  });

  it('adds Campaign Summary spend to each kind, platform and campaign', () => {
    const rows = [
      lead({ phone: '+919000000001' }),
      lead({ phone: '+919000000002', source: 'Google ads', campaignId: 'Google | 0001 | 2026 | 09 | Storevisit' }),
      lead({ phone: '+919000000003', campaignId: 'Meta | 0004 | 2026 | 09 | Virtual Shopping (Video)', sheetTabs: ['Virtual calls - Oct'] }),
    ];
    const spend = [
      { campaign: 'Meta | 0001 | 2026 | 09 | Storevisit', platform: 'Meta ads', spend: 1000, leads: 10, weeks: 2 },
      { campaign: 'Google  | 0001 | 2026 | 09 | Storevisit', platform: 'Google ads', spend: 400, leads: 4, weeks: 1 },
      { campaign: 'Meta | 0004 | 2026 | 09 | Virtual Shopping (Video)', platform: 'Meta ads', spend: 300, leads: 3, weeks: 1 },
      { campaign: 'Meta | 0009 | 2026 | 10 | BLVD Club Exhibition', platform: 'Meta ads', spend: 999, leads: 9, weeks: 1 },
    ];
    const { kinds: [storeVisit, virtualCalls], campaigns } = summarizeLeadTypes(rows, [], spend);
    expect([storeVisit.total.spend, storeVisit.total.sheetLeads]).toEqual([1400, 14]);
    expect(storeVisit.platforms.map((p) => [p.platform, p.spend])).toEqual([['Meta ads', 1000], ['Google ads', 400]]);
    expect(virtualCalls.total.spend).toBe(300);
    expect(campaigns.map((c) => [c.kind, c.campaign.split(' | ')[1], c.spend, c.stats.leads])).toEqual([
      ['Store visit', '0001', 1000, 1], ['Store visit', '0001', 400, 1], ['Virtual calls', '0004', 300, 1], ['Exhibition', '0009', 999, 0],
    ]);
  });

  it('types a campaign by its name, not by the tab one of its leads landed on', () => {
    const rows = [
      lead({ phone: '+919000000001', sheetTabs: ['Virtual calls - Oct'] }),
      lead({ phone: '+919000000002' }),
      lead({ phone: '+919000000003', campaignId: 'Meta | 0009 | 2026 | 10 | BLVD Club Exhibition', sheetTabs: ['Virtual calls - Oct'] }),
    ];
    const { kinds: [storeVisit, virtualCalls], campaigns } = summarizeLeadTypes(rows, []);
    expect(campaigns.map((c) => [c.campaign.split(' | ')[1], c.kind, c.stats.leads])).toEqual([['0001', 'Store visit', 2], ['0009', 'Exhibition', 1]]);
    expect([storeVisit.total.stats.leads, virtualCalls.total.stats.leads]).toEqual([1, 2]);
  });
});

describe('campaignKind', () => {
  it('types every campaign by name', () => {
    expect(campaignKind('Meta | 0007 | 2026 | 07 | Storevisit')).toBe('Store visit');
    expect(campaignKind('Meta | 0004 | 2026 | 09 | Virtual Shopping (Video)')).toBe('Virtual calls');
    expect(campaignKind('AdOnMo | 0001 | 2026 | 10 | Shubh Convention Centre')).toBe('Exhibition');
    expect(campaignKind('Meta | 0009 | 2026 | 10 | BLVD Club (Blr) | Lead Gen')).toBe('Exhibition');
    expect(campaignKind('Meta | 0013 | 2026 | 10 | The Residency (Chennai)')).toBe('Exhibition');
    expect(campaignKind('CAM-2026-001')).toBe('Other');
  });
});
