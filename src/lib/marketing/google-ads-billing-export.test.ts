import { describe, expect, it } from 'vitest';
import { billingDay, parseGoogleBillingExport } from './google-ads-billing-export';

const REPORT = `Billing activity report,,,,,,
"September 1, 2026 - November 11, 2026",,,,,,
Date,Type,Description,Interactions,Costs,Credits,Running balance
"Nov 11, 2026",Taxes and fees,"Estimated Integrated GST: Nov 1, 2026 - Nov 11, 2026",--,"-₹3,821.45",--,"₹25,038.38"
"Nov 11, 2026",Adjustments,"Overrun: Nov 3, 2026 - Nov 11, 2026",--,--,₹0.26,"₹28,859.83"
"Nov 11, 2026",Campaigns,Google | 0001 | 2026 | 09 | Storevisit,31 clicks,-₹662.57,₹0.00,"₹28,859.57"
"Nov 10, 2026",Payments,Manual payment: NetBanking,--,--,"₹25,000.00","₹32,824.86"
"Oct 28, 2026",Campaigns,Google | 0001 | 2026 | 09 | Storevisit,78 clicks,"-₹1,322.53",₹0.01,"₹15,862.45"
"Oct 28, 2026",Campaigns,Google | 0003 | 2026 | 09 | Pmax,"267 clicks, impressions",-₹461.11,₹0.04,"₹18,763.41"`;

describe('parseGoogleBillingExport', () => {
  it('reads campaign cost per day before GST, as the API sync saves it', () => {
    const parsed = parseGoogleBillingExport(REPORT);
    expect(parsed).toMatchObject({ from: '2026-09-01', to: '2026-11-11', total: 2446.21, taxes: 3821.45 });
    expect(parsed.rows).toEqual([
      { campaign: 'Google | 0001 | 2026 | 09 | Storevisit', platform: 'Google ads', month: '2026-10', week: '2026-10-28', spend: 1322.53, leads: null },
      { campaign: 'Google | 0003 | 2026 | 09 | Pmax', platform: 'Google ads', month: '2026-10', week: '2026-10-28', spend: 461.11, leads: null },
      { campaign: 'Google | 0001 | 2026 | 09 | Storevisit', platform: 'Google ads', month: '2026-11', week: '2026-11-11', spend: 662.57, leads: null },
    ]);
  });

  it('refuses a file that is not a billing activity report', () => {
    expect(() => parseGoogleBillingExport('Name,Phone\nA,1')).toThrow(/billing activity report/);
  });
});

it('reads billing dates', () => {
  expect(billingDay('Nov 1, 2026')).toBe('2026-11-01');
  expect(billingDay('September 30, 2026')).toBe('2026-09-30');
  expect(billingDay('--')).toBe('');
});
