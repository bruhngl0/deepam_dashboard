/**
 * One month's incentives per salesperson, from their credited bills (see ./slabs for the rules).
 * Pure: the database reads are in ./store.
 *
 *   Business      the month's credited bills: sales less returns, as on the bill (with GST, after discount).
 *   Old stock     the bill lines aged 2 years or more on the sale day; left out of the volume and paid by age.
 *   Volume        Business − Old stock.
 *   Lakh business each customer's Business with the salesperson that month; a bill with no customer stands alone.
 */

import { AGE_BANDS, lakhIncentive, LAKH_BANDS, volumeIncentive, type IncentiveStore } from './slabs';

export type IncentiveBill = { billId: number; empCode: string; personId: number | null; amount: number };
/** Old-stock value of one bill in one age band (1–3; band 0 is new stock and never listed). */
export type OldStockLine = { billId: number; band: number; amount: number };
export type IncentivePerson = { empCode: string; name: string; store: IncentiveStore; weekendStaff: boolean };

export type IncentiveRow = IncentivePerson & {
  bills: number; business: number; oldStock: number; volume: number; volumeIncentive: number;
  /** Per AGE_BANDS index 1–3: old-stock value and its incentive. */
  age: { band: number; amount: number; incentive: number }[]; ageIncentive: number;
  /** Customers per LAKH_BANDS index (0 unused) and their total incentive. */
  lakhCustomers: number[]; lakhIncentive: number;
  total: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeIncentives(people: IncentivePerson[], bills: IncentiveBill[], oldStock: OldStockLine[]): IncentiveRow[] {
  const empOf = new Map(bills.map((b) => [b.billId, b.empCode]));
  return people.map((p) => {
    const mine = bills.filter((b) => b.empCode === p.empCode);
    const business = mine.reduce((s, b) => s + b.amount, 0);

    const byBand = new Map<number, number>();
    for (const l of oldStock) if (empOf.get(l.billId) === p.empCode && l.band > 0) byBand.set(l.band, (byBand.get(l.band) ?? 0) + l.amount);
    const age = [1, 2, 3].map((band) => {
      const amount = r2(byBand.get(band) ?? 0);
      return { band, amount, incentive: r2(Math.max(0, amount) * AGE_BANDS[band].rate) };
    });
    const oldStockValue = age.reduce((s, a) => s + a.amount, 0);
    const volume = r2(business - oldStockValue);

    const perCustomer = new Map<string, number>();
    for (const b of mine) {
      const key = b.personId === null ? `bill:${b.billId}` : `person:${b.personId}`;
      perCustomer.set(key, (perCustomer.get(key) ?? 0) + b.amount);
    }
    const lakhCustomers = LAKH_BANDS.map(() => 0);
    let lakh = 0;
    for (const value of perCustomer.values()) {
      const amount = lakhIncentive(value);
      if (!amount) continue;
      lakh += amount;
      lakhCustomers[LAKH_BANDS.findLastIndex((b) => value >= b.from)] += 1;
    }

    const vol = volumeIncentive(p.store, volume, p.weekendStaff);
    const ageIncentive = r2(age.reduce((s, a) => s + a.incentive, 0));
    return {
      ...p, bills: mine.filter((b) => b.amount > 0).length, business: r2(business), oldStock: r2(oldStockValue), volume, volumeIncentive: vol,
      age, ageIncentive, lakhCustomers, lakhIncentive: lakh, total: r2(vol + ageIncentive + lakh),
    };
  });
}
