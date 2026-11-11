import { describe, expect, it } from 'vitest';
import { computeIncentives } from './compute';
import { ageBand, lakhIncentive, stockAgeYears, volumeIncentive } from './slabs';

describe('slabs', () => {
  it('pays the band a volume falls in, from its lower figure', () => {
    expect(volumeIncentive('STR-001', 999_999, false)).toBe(0);
    expect(volumeIncentive('STR-001', 1_000_000, false)).toBe(10_000);
    expect(volumeIncentive('STR-001', 4_999_999, false)).toBe(40_000);
    expect(volumeIncentive('STR-001', 9_000_000, false)).toBe(50_000);
    expect(volumeIncentive('STR-002', 700_000, false)).toBe(10_000);
    expect(volumeIncentive('STR-002', 1_499_999, false)).toBe(10_000);
    expect(volumeIncentive('STR-002', 4_500_000, false)).toBe(50_000);
  });
  it('pays weekend staff ₹5,000 at ₹5 L (MG Road) or ₹3.5 L (Jayanagar), instead of the bands', () => {
    expect(volumeIncentive('STR-001', 499_999, true)).toBe(0);
    expect(volumeIncentive('STR-001', 2_500_000, true)).toBe(5_000);
    expect(volumeIncentive('STR-002', 350_000, true)).toBe(5_000);
  });
  it('pays lakh business per customer', () => {
    expect([99_999, 100_000, 300_000, 500_000].map(lakhIncentive)).toEqual([0, 500, 1_000, 2_000]);
  });
  it('ages stock in full years from the inward date', () => {
    expect(stockAgeYears('2024-10-11', '2026-10-10')).toBe(1);
    expect(stockAgeYears('2024-10-10', '2026-10-10')).toBe(2);
    expect(stockAgeYears(null, '2026-10-10')).toBeNull();
    expect([null, 1, 2, 4, 5, 9, 10, 30].map(ageBand)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('computeIncentives', () => {
  const people = [{ empCode: 'EMP-0001', name: 'A', store: 'STR-001' as const, weekendStaff: false }];
  it('leaves old stock out of the volume and pays it by age; lakh per customer, returns netted', () => {
    const [row] = computeIncentives(people, [
      { billId: 1, empCode: 'EMP-0001', personId: 7, amount: 900_000 },
      { billId: 2, empCode: 'EMP-0001', personId: 7, amount: 250_000 },
      { billId: 3, empCode: 'EMP-0001', personId: null, amount: 120_000 },
      { billId: 4, empCode: 'EMP-0001', personId: 8, amount: -20_000 },
      { billId: 9, empCode: 'EMP-0002', personId: 7, amount: 5_000_000 },
    ], [{ billId: 1, band: 1, amount: 100_000 }, { billId: 2, band: 3, amount: 50_000 }, { billId: 9, band: 3, amount: 1 }]);
    expect(row).toMatchObject({
      bills: 3, business: 1_250_000, oldStock: 150_000, volume: 1_100_000, volumeIncentive: 10_000,
      ageIncentive: 5_500, lakhCustomers: [0, 1, 0, 1], lakhIncentive: 2_500, total: 18_000,
    });
  });
});
