import { describe, expect, it } from 'vitest';
import { campaignKpis, NO_SETTINGS, overlaps, parseSettings, suggestVenue, type ReportBill } from './campaign-report';

const bill = (over: Partial<ReportBill>): ReportBill => ({
  id: 'b1', amount: 1000, date: '2026-10-16', customerId: 'c1', firstBill: '2026-10-16',
  fromLead: true, atEvent: false, since: '2026-10-10', cost: 600, ...over,
});

describe('campaignKpis', () => {
  it('works out every KPI from leads, bills, visits and cost', () => {
    const k = campaignKpis({
      leads: 10, convertedLeads: 2, spend: 5000,
      settings: { ...NO_SETTINGS, venueStoreId: 12, from: '2026-10-16', to: '2026-10-18', exhibitionExpense: 15000 },
      bills: [
        bill({ id: 'b1' }),
        bill({ id: 'b1' }), // the same bill twice counts once
        bill({ id: 'b2', customerId: 'c2', firstBill: '2026-06-01', amount: 3000, cost: null }),
        bill({ id: 'b3', customerId: 'c3', fromLead: false, atEvent: true, since: '2026-10-16', firstBill: '2026-10-17', amount: 2000, cost: 1000 }),
        bill({ id: 'b4', customerId: null, fromLead: false, atEvent: true, amount: 4000, cost: 2000 }),
      ],
      visits: [{ id: 'v1', people: 2, converted: true }, { id: 'v2', people: 1, converted: false }],
    });
    expect(k).toMatchObject({
      leadConversion: 20, leadSales: 4000, leadBills: 2,
      footfall: 2, footfallPeople: 3, footfallConverted: 1, footfallConversion: 50,
      bills: 4, sales: 10000, averageBill: 2500,
      customers: 3, newCustomers: 2, existingCustomers: 1, billsWithoutCustomer: 1,
      marketingSpend: 5000, exhibitionExpense: 15000, investment: 20000,
      costPerLead: 500, acquisitionCost: 10000,
      grossProfit: 3400, billsWithoutCost: 1,
    });
    expect(k.newCustomerShare).toBeCloseTo(66.67, 1);
    expect(k.grossProfitShare).toBeCloseTo(48.57, 1);
  });

  it('shows no cost per lead without spend, and no ratios without data', () => {
    const k = campaignKpis({ leads: 0, convertedLeads: 0, spend: null, settings: NO_SETTINGS, bills: [], visits: [] });
    expect(k).toMatchObject({ spendFound: false, costPerLead: null, acquisitionCost: null, leadConversion: null, averageBill: null, grossProfit: null, footfallConversion: null });
  });
});

describe('parseSettings', () => {
  it('accepts a venue with dates and an expense', () => {
    expect(parseSettings({ venueStoreId: '12', from: '2026-10-16', to: '2026-10-19', exhibitionExpense: '25000' }))
      .toEqual({ venueStoreId: 12, from: '2026-10-16', to: '2026-10-19', exhibitionExpense: 25000 });
  });
  it('rejects half-filled or backwards dates and negative expense', () => {
    expect(parseSettings({ venueStoreId: 12, from: '2026-10-16', to: '' })).toMatch(/both/);
    expect(parseSettings({ from: '2026-10-19', to: '2026-10-16' })).toMatch(/end before/);
    expect(parseSettings({ venueStoreId: 12 })).toMatch(/dates/);
    expect(parseSettings({ exhibitionExpense: -1 })).toMatch(/zero or more/);
  });
});

describe('suggestVenue', () => {
  const venues = [{ id: 12, name: 'Shubh Convention' }, { id: 13, name: 'BLVD Collection' }, { id: 14, name: 'The Residency-Chennai' }];
  it('finds the venue named in the campaign', () => {
    expect(suggestVenue('Meta | 0010 | 2026 | 10 | Shubh Convention Centre Exhibition', venues)?.id).toBe(12);
    expect(suggestVenue('Meta | 0009 | 2026 | 10 | BLVD Club Exhibition', venues)?.id).toBe(13);
    expect(suggestVenue('Meta | 0013 | 2026 | 10 | The Residency (Chennai)', venues)?.id).toBe(14);
    expect(suggestVenue('Meta | 0001 | 2026 | 09 | Storevisit', venues)).toBeNull();
  });
});

it('overlaps', () => {
  const a = { ...NO_SETTINGS, from: '2026-10-16', to: '2026-10-19' };
  expect(overlaps(a, { ...NO_SETTINGS, from: '2026-10-16', to: '2026-10-17' })).toBe(true);
  expect(overlaps(a, { ...NO_SETTINGS, from: '2026-10-23', to: '2026-10-26' })).toBe(false);
});
