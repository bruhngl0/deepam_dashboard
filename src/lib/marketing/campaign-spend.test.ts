import { describe, expect, it } from 'vitest';
import { money, parseCampaignSummary, spendByCampaign } from './campaign-spend';

// The top of the Meta sheet's Campaign Summary tab as the export delivers it.
const grid: unknown[][] = [
  [' DEEPAM BY ANANTA  ·  META ADS  ·  CAMPAIGN SUMMARY'],
  ['One row per campaign  ·  Enter campaign name, dates, and weekly spend, leads & cost per lead'],
  ['Campaign name', 'Platform', 'Start date', 'End date', 'Week 1 spend', 'No of leads', 'Cost per lead', 'Week 2 spend', 'No of leads', 'Cost per lead', 'Week 3 spend', 'No of leads', 'Cost per lead', 'Week 4 spend', 'No of leads', 'Cost per lead'],
  ['Meta | 0007 | 2026 | 07 | Storevisit', 'Meta', 46217, 46224, '-', '-', '-', '₹1,025.96', 7, '₹146.57', '₹15,535.88', 376, '₹41.32', '-', '-', '-'],
  ['Meta | 0001 | 2026 | 09 | Storevisit', 'Meta', 46220, '-', '-', '-', '-', '-', '-', '-', '₹12,168.92', 461, '₹26.40', '₹46,830.09', 934, '₹50.14'],
  ['July', 'Meta', '', '', '1-7 July', '', '', '8-14 July', '', '', '15-21 July', '', '', '22-31 July', '', ''],
  ['Meta | 0001 | 2026 | 09 | Storevisit', 'Meta', 46220, '-', '₹34,691.79', 592, '₹58.60', '', '', '', '', '', '', '', '', ''],
  ['Aug', 'Meta', '', '', '1-7 Aug', '', '', '8-14 Aug', '', '', '15-21 Aug', '', '', '22-31 Aug', '', ''],
  ['Meta | 0004 | 2026 | 09 | Virtual Shopping (Video)', 'Meta', 46287, '-', '₹4,716.86', 17, '₹277.46'],
  ['', 'Meta'],
];

describe('money', () => {
  it('reads rupee text and numbers, and treats dashes and blanks as empty', () => {
    expect(money('₹14,565.54')).toBe(14565.54);
    expect(money(250)).toBe(250);
    expect(money('-')).toBeNull();
    expect(money('')).toBeNull();
  });
});

describe('parseCampaignSummary', () => {
  const weeks = parseCampaignSummary(grid);
  it('labels each week from the month row below its block', () => {
    expect(weeks.filter((w) => w.month === 'July').map((w) => [w.campaign.split(' | ')[1], w.week, w.spend, w.leads])).toEqual([
      ['0007', '8-14 July', 1025.96, 7], ['0007', '15-21 July', 15535.88, 376],
      ['0001', '15-21 July', 12168.92, 461], ['0001', '22-31 July', 46830.09, 934],
    ]);
    expect(weeks.find((w) => w.month === 'Aug')).toMatchObject({ week: '1-7 Aug', spend: 34691.79, leads: 592, platform: 'Meta ads' });
  });
  it('keeps rows after the last month row, with no month', () => {
    expect(weeks.at(-1)).toMatchObject({ campaign: 'Meta | 0004 | 2026 | 09 | Virtual Shopping (Video)', month: '', week: '', spend: 4716.86, leads: 17 });
  });
  it('totals spend and leads per campaign', () => {
    const meta1 = spendByCampaign(weeks).find((c) => c.campaign.includes('0001'));
    expect(meta1).toEqual({ campaign: 'Meta | 0001 | 2026 | 09 | Storevisit', platform: 'Meta ads', spend: 93690.8, leads: 1987, weeks: 3 });
  });
  it('returns nothing for a tab without the heading row', () => {
    expect(parseCampaignSummary([['Name', 'Phone']])).toEqual([]);
  });
});
