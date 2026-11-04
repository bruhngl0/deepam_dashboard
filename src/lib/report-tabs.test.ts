import { describe, expect, it } from 'vitest';
import { currentReport } from './report-tabs';

describe('report tabs', () => {
  it('lights the report a page is, the most specific one first', () => {
    expect(currentReport('/reports/salespeople')).toBe('/reports/salespeople');
    expect(currentReport('/reports/salespeople/match')).toBe('/reports/salespeople/match');
    expect(currentReport('/reports/funnel')).toBe('/reports/funnel');
    expect(currentReport('/reports')).toBeNull();
  });
});
