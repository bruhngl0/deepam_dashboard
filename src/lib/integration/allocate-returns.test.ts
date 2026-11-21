import { describe, expect, it } from 'vitest';
import { allocateReturns, type BillLine } from './allocate-returns';

const line = (saleId: number, customerId: number | null, barcode: string, date: string, qty: number, amount: number): BillLine =>
  ({ saleId, customerId, barcode, date, qty, amount });

describe('allocateReturns', () => {
  it('marks a bill fully returned when every piece comes back', () => {
    expect(allocateReturns([
      line(1, 7, 'A', '2026-10-01', 1, 1000),
      line(2, 7, 'A', '2026-10-05', -1, -1000),
    ])).toEqual([{ saleId: 1, returnedAmount: 1000, fullyReturned: true }]);
  });

  it('marks a bill partly returned when only some pieces come back', () => {
    expect(allocateReturns([
      line(1, 7, 'A', '2026-10-01', 1, 1000),
      line(1, 7, 'B', '2026-10-01', 1, 500),
      line(2, 7, 'B', '2026-10-05', -1, -500),
    ])).toEqual([{ saleId: 1, returnedAmount: 500, fullyReturned: false }]);
  });

  it("uses the same customer's latest earlier sale", () => {
    expect(allocateReturns([
      line(1, 7, 'A', '2026-09-01', 1, 900),
      line(2, 8, 'A', '2026-10-02', 1, 950),
      line(3, 7, 'A', '2026-10-01', 1, 1000),
      line(4, 7, 'A', '2026-10-05', -1, -1000),
    ])).toEqual([{ saleId: 3, returnedAmount: 1000, fullyReturned: true }]);
  });

  it('ignores a sale dated after the return', () => {
    expect(allocateReturns([
      line(1, 7, 'A', '2026-10-10', 1, 1000),
      line(2, 7, 'A', '2026-10-05', -1, -1000),
    ])).toEqual([]);
  });

  it("falls back to the barcode's only sale when the return has another number", () => {
    expect(allocateReturns([
      line(1, 7, 'A', '2026-10-01', 1, 1000),
      line(2, 9, 'A', '2026-10-05', -1, -1000),
    ])).toEqual([{ saleId: 1, returnedAmount: 1000, fullyReturned: true }]);
  });

  it('does not guess between several sales of another customer', () => {
    expect(allocateReturns([
      line(1, 7, 'A', '2026-10-01', 1, 1000),
      line(2, 8, 'A', '2026-10-02', 1, 1000),
      line(3, 9, 'A', '2026-10-05', -1, -1000),
    ])).toEqual([]);
  });

  it('never returns more than was sold', () => {
    expect(allocateReturns([
      line(1, 7, 'A', '2026-10-01', 1, 1000),
      line(2, 7, 'A', '2026-10-05', -1, -1000),
      line(3, 7, 'A', '2026-10-06', -1, -1000),
    ])).toEqual([{ saleId: 1, returnedAmount: 1000, fullyReturned: true }]);
  });
});
