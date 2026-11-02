import { describe, expect, it } from 'vitest';
import { campaignGroup, campaignGroupCodes } from './campaign-groups';
import { summarizeLeadTypes } from './lead-type-conversions';
import { campaignName } from './local';

const VML = 'Meta | Varamahalakshmi (0006, 0007, 0008)';

describe('campaign groups', () => {
  it('reports the three Varamahalakshmi campaigns as one', () => {
    for (const c of ['Meta | 0006 | 2026 | 07 | Varamahalakshmi', 'Meta | 0007 | 2026 | 07 | Storevisit', ' meta|0008|2026|07|Varamahalakshmi ']) expect(campaignGroup(c)).toBe(VML);
    expect(campaignGroup('Meta | 0001 | 2026 | 09 | Storevisit')).toBe('Meta | 0001 | 2026 | 09 | Storevisit');
    expect(campaignGroup('Google | 0006 | 2026 | 07 | Other')).toBe('Google | 0006 | 2026 | 07 | Other');
    expect(campaignGroupCodes(VML)).toEqual(['0006', '0007', '0008']);
    expect(campaignGroupCodes('Meta | 0001 | 2026 | 09 | Storevisit')).toBeNull();
    expect(campaignName('Meta | 0007 | 2026 | 07 | Varamahalakshmi')).toBe('Varamahalakshmi (0006, 0007, 0008)');
  });

  it('makes one campaign row with each person once and the spend summed', () => {
    const row = (phone: string, campaignId: string) => ({ phone, date: '2026-07-20', source: 'Meta ads', campaignId, claimGroup: '', sheetTabs: [] });
    const { campaigns } = summarizeLeadTypes(
      [row('+911', 'Meta | 0006 | 2026 | 07 | Varamahalakshmi'), row('+911', 'Meta | 0007 | 2026 | 07 | Varamahalakshmi'), row('+912', 'Meta | 0008 | 2026 | 07 | Varamahalakshmi')],
      [{ phone: '+911', invoice: 'X1', amount: 1000, date: '2026-08-01' }],
      [{ campaign: 'Meta | 0006 | 2026 | 07 | Storevisit', platform: 'Meta ads', spend: 100, leads: 5, weeks: 1 }, { campaign: 'Meta | 0008 | 2026 | 07 | Storevisit', platform: 'Meta ads', spend: 50, leads: 2, weeks: 1 }],
    );
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({ campaign: VML, spend: 150, sheetLeads: 7, stats: { leads: 2, converted: 1, sales: 1000 } });
  });
});
