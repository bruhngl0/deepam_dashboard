import { describe, expect, it } from 'vitest';
import { campaignBuyers, campaignCode } from './campaign-buyers';
import { makeLead, type Dataset, type Sale } from './local';

const lead = (phone: string, date: string, ...acquisitions: [string, string][]) => {
  const l = makeLead({ phone, name: phone, source: acquisitions[0][0], campaignId: acquisitions[0][1], acquiredAt: `${date}T10:00:00` });
  l.acquisitions = acquisitions.map(([source, campaignId]) => ({ source, campaignId, at: `${date}T10:00:00`, cost: null }));
  return l;
};
const sale = (phone: string, invoice: string, date: string, amount: number): Sale => ({ phone, invoice, date, amount, store: 'MG' });
const VML6 = 'Meta | 0006 | 2026 | 07 | Varamahalakshmi', VML7 = 'Meta | 0007 | 2026 | 07 | Varamahalakshmi', VML8 = 'Meta | 0008 | 2026 | 07 | Varamahalakshmi';
const SHUBH = 'Meta | 0010 | 2026 | 10 | Shubh Convention Centre Exhibition', SHUBH_FORM = 'Meta | 0010 | 2026 | 10 | Shubh Convention Centre (Blr) | Lead Gen';
const GOOGLE = 'Google | 0001 | 2026 | 09 | Storevisit';

describe('campaignBuyers', () => {
  it('merges the three Varamahalakshmi campaigns and counts each person once', () => {
    const a = lead('+911', '2026-07-20', ['Meta ads', VML6], ['Meta ads', VML7]);
    const b = lead('+912', '2026-07-21', ['Meta ads', VML8]);
    const data: Dataset = { version: 2, demo: false, leads: [a, b], sales: [sale('+911', 'X1', '2026-08-01', 1000), sale('+911', 'X2', '2026-08-02', 500), sale('+912', 'X3', '2026-07-01', 900)] };
    const [row] = campaignBuyers(data, data.leads, '', null);
    expect(row).toMatchObject({ campaign: 'Meta Varamahalakshmi (0006, 0007, 0008)', leads: 2, converted: 1, bills: 2, sales: 1500, rate: 0.5, spend: null });
  });

  it('groups a campaign’s lead form with its exhibition and matches spend by campaign number', () => {
    const a = lead('+911', '2026-10-10', ['Meta ads', SHUBH]);
    const b = lead('+912', '2026-10-11', ['Meta ads', SHUBH_FORM]);
    const data: Dataset = { version: 2, demo: false, leads: [a, b], sales: [sale('+912', 'X1', '2026-10-15', 2000)] };
    const spend = [{ campaign: 'Meta | 0010 | 2026 | 10 | Shubh Convention Centre Exhibition', platform: 'Meta ads', spend: 1000, leads: 50, weeks: 2 },
      { campaign: GOOGLE, platform: 'Google ads', spend: 9999, leads: 9, weeks: 1 }];
    const [row] = campaignBuyers(data, data.leads, '', spend);
    expect(row).toMatchObject({ campaign: 'Meta 0010 Shubh Convention Centre Exhibition', leads: 2, converted: 1, spend: 1000, costPerBuyer: 1000, salesPerRupee: 2 });
  });

  it('keeps only the chosen source’s acquisitions', () => {
    const a = lead('+911', '2026-09-10', ['Meta ads', VML6], ['Google ads', GOOGLE]);
    const data: Dataset = { version: 2, demo: false, leads: [a], sales: [] };
    expect(campaignBuyers(data, data.leads, 'Meta ads', null).map((r) => r.source)).toEqual(['Meta ads']);
    expect(campaignBuyers(data, data.leads, '', null)).toHaveLength(2);
  });

  it('reads campaign numbers', () => {
    expect(campaignCode(GOOGLE)).toBe('0001');
    expect(campaignCode('Online Chennai')).toBeNull();
  });
});
