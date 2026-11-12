/**
 * Salesperson incentive slabs from the management circulars No. 008 (MG Road) and No. 009 (Jayanagar),
 * dated 21/09/2026, in effect from 1 September 2026. Monthly, per salesperson, by their home store.
 *
 *   Business volume  a flat amount for the band the month's business falls in, old stock left out.
 *                    A band starts at its lower figure: exactly ₹10 L at MG Road is ₹10,000.
 *   Weekend staff    instead of the volume bands: ₹5,000 once the month reaches ₹5 L (MG Road) or ₹3.5 L (Jayanagar).
 *   Age-wise stock   a share of old-stock business by the stock's age on the day it sold (sale date − inward date):
 *                    under 2 years nil, 2–5 years 2%, 5–10 years 5%, 10 years and more 7%.
 *   Lakh business    a flat amount per customer, by their month's business with that salesperson.
 *
 * Not applied: "Special Incentive (Scanned Products) 3%". Nothing in the sales data says which products
 * were scanned.
 */

export const INCENTIVES_FROM = '2026-09-01';
const L = 100_000;

export type IncentiveStore = 'STR-001' | 'STR-002';
export const INCENTIVE_STORES: Record<IncentiveStore, { name: string; circular: string }> = {
  'STR-001': { name: 'MG Road', circular: 'No. 008 – 21/09/2026' },
  'STR-002': { name: 'Jayanagar', circular: 'No. 009 – 21/09/2026' },
};

export type Band = { from: number; amount: number };

/** Volume bands, lowest first: each applies from its `from` up to the next band's. */
export const VOLUME_BANDS: Record<IncentiveStore, Band[]> = {
  'STR-001': [{ from: 0, amount: 0 }, { from: 10 * L, amount: 10_000 }, { from: 20 * L, amount: 20_000 }, { from: 30 * L, amount: 30_000 }, { from: 40 * L, amount: 40_000 }, { from: 50 * L, amount: 50_000 }],
  'STR-002': [{ from: 0, amount: 0 }, { from: 7 * L, amount: 10_000 }, { from: 15 * L, amount: 20_000 }, { from: 25 * L, amount: 30_000 }, { from: 35 * L, amount: 40_000 }, { from: 45 * L, amount: 50_000 }],
};

export const WEEKEND: Record<IncentiveStore, { from: number; amount: number }> = {
  'STR-001': { from: 5 * L, amount: 5_000 },
  'STR-002': { from: 3.5 * L, amount: 5_000 },
};

export const LAKH_BANDS: Band[] = [{ from: 0, amount: 0 }, { from: 1 * L, amount: 500 }, { from: 3 * L, amount: 1_000 }, { from: 5 * L, amount: 2_000 }];

/** Age-wise rates by full years of age, lowest first. Under 2 years is new stock. */
export const AGE_BANDS = [
  { years: 0, rate: 0, label: 'Under 2 years' },
  { years: 2, rate: 0.02, label: '2–5 years' },
  { years: 5, rate: 0.05, label: '5–10 years' },
  { years: 10, rate: 0.07, label: '10 years and more' },
] as const;

export const isIncentiveStore = (code: string | null): code is IncentiveStore => code === 'STR-001' || code === 'STR-002';

export function band(bands: Band[], value: number): number {
  let amount = 0;
  for (const b of bands) if (value >= b.from) amount = b.amount;
  return amount;
}

export function volumeIncentive(store: IncentiveStore, volume: number, weekendStaff: boolean): number {
  if (weekendStaff) return volume >= WEEKEND[store].from ? WEEKEND[store].amount : 0;
  return band(VOLUME_BANDS[store], volume);
}

export const lakhIncentive = (customerBusiness: number) => band(LAKH_BANDS, customerBusiness);

/** Full years between the inward date and the sale date (both YYYY-MM-DD); null when there is no inward date. */
export function stockAgeYears(inward: string | null, sold: string): number | null {
  if (!inward) return null;
  const [iy, im, id] = inward.split('-').map(Number), [sy, sm, sd] = sold.split('-').map(Number);
  return sy - iy - (sm < im || (sm === im && sd < id) ? 1 : 0);
}

/** Index into AGE_BANDS; a line with no inward date counts as new stock. */
export function ageBand(years: number | null): number {
  let at = 0;
  AGE_BANDS.forEach((b, i) => { if ((years ?? 0) >= b.years) at = i; });
  return at;
}
