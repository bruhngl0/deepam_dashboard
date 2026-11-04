import { describe, expect, it } from 'vitest';
import { googleAdsConfig, spendQuery, spendRowsFromResults } from './google-ads-spend';

const env = { GOOGLE_ADS_DEVELOPER_TOKEN: 'dev', GOOGLE_ADS_CLIENT_ID: 'id', GOOGLE_ADS_CLIENT_SECRET: 'secret', GOOGLE_ADS_REFRESH_TOKEN: 'refresh', GOOGLE_ADS_CUSTOMER_ID: '123-456-7890' };

describe('googleAdsConfig', () => {
  it('is off until every required setting is there', () => {
    expect(googleAdsConfig({})).toBeNull();
    expect(googleAdsConfig({ ...env, GOOGLE_ADS_REFRESH_TOKEN: ' ' })).toBeNull();
  });
  it('takes the customer IDs as digits and has defaults', () => {
    expect(googleAdsConfig({ ...env, GOOGLE_ADS_LOGIN_CUSTOMER_ID: '111-222-3333' })).toMatchObject({ customerId: '1234567890', loginCustomerId: '1112223333', from: '2026-01-01', version: 'v26' });
    expect(googleAdsConfig({ ...env, GOOGLE_ADS_SPEND_FROM: '2026-05-01', GOOGLE_ADS_API_VERSION: 'v27' })).toMatchObject({ loginCustomerId: null, from: '2026-05-01', version: 'v27' });
    expect(googleAdsConfig({ ...env, GOOGLE_ADS_SPEND_FROM: 'May' })?.from).toBe('2026-01-01');
  });
});

describe('spendRowsFromResults', () => {
  it('turns campaign-days into Google spend rows in rupees', () => {
    expect(spendRowsFromResults([
      { campaign: { name: ' Google | 0016 | 2026 | 10 | Search ' }, segments: { date: '2026-10-21' }, metrics: { costMicros: '1234567890' } },
      { campaign: { name: 'Google | 0016 | 2026 | 10 | Search' }, segments: { date: '2026-10-22' }, metrics: { costMicros: 500000 } },
    ])).toEqual([
      { campaign: 'Google | 0016 | 2026 | 10 | Search', platform: 'Google ads', month: '2026-10', week: '2026-10-21', spend: 1234.57, leads: null },
      { campaign: 'Google | 0016 | 2026 | 10 | Search', platform: 'Google ads', month: '2026-10', week: '2026-10-22', spend: 0.5, leads: null },
    ]);
  });
  it('skips rows without a name, a day or spend', () => {
    expect(spendRowsFromResults([{ segments: { date: '2026-10-21' }, metrics: { costMicros: '10' } }, { campaign: { name: 'A' }, metrics: { costMicros: '10' } }, { campaign: { name: 'A' }, segments: { date: '2026-10-21' }, metrics: { costMicros: '0' } }])).toEqual([]);
  });
});

it('asks for spend by campaign and day in the range', () => {
  expect(spendQuery('2026-01-01', '2026-11-04')).toContain("segments.date BETWEEN '2026-01-01' AND '2026-11-04'");
});
