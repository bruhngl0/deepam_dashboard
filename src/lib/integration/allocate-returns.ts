/**
 * The ERP's return vouchers do not say which bill they reverse, so a returned piece is traced by
 * barcode. It goes to the same customer's latest earlier sale of that barcode. When that customer
 * has none (the return was billed under another number), it goes to the barcode's only earlier
 * sale; with several possible sales it stays unallocated rather than guessing.
 */

export type BillLine = {
  saleId: number;
  customerId: number | null;
  barcode: string;
  /** IST bill date, YYYY-MM-DD. */
  date: string;
  /** Signed: positive on a sale, negative on a return. */
  qty: number;
  amount: number;
};

export type SaleReturn = { saleId: number; returnedAmount: number; fullyReturned: boolean };

const EPSILON = 0.001;

export function allocateReturns(lines: BillLine[]): SaleReturn[] {
  const sold = lines
    .filter((line) => line.qty > 0)
    .map((line) => ({ ...line, remaining: line.qty }));
  const byBarcode = new Map<string, typeof sold>();
  for (const line of sold) {
    const group = byBarcode.get(line.barcode);
    if (group) group.push(line);
    else byBarcode.set(line.barcode, [line]);
  }
  const latestFirst = (a: (typeof sold)[number], b: (typeof sold)[number]) =>
    b.date.localeCompare(a.date) || b.saleId - a.saleId;
  for (const group of byBarcode.values()) group.sort(latestFirst);

  const returns = lines
    .filter((line) => line.qty < 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.saleId - b.saleId);

  for (const line of returns) {
    const earlier = (byBarcode.get(line.barcode) ?? []).filter((s) => s.date <= line.date);
    const own = line.customerId === null ? [] : earlier.filter((s) => s.customerId === line.customerId);
    const candidates = own.length > 0
      ? own
      : new Set(earlier.map((s) => s.saleId)).size === 1 ? earlier : [];
    let left = -line.qty;
    for (const sale of candidates) {
      if (left <= EPSILON) break;
      const taken = Math.min(left, sale.remaining);
      sale.remaining -= taken;
      left -= taken;
    }
  }

  const totals = new Map<number, { qty: number; remaining: number; returnedAmount: number }>();
  for (const line of sold) {
    const total = totals.get(line.saleId) ?? { qty: 0, remaining: 0, returnedAmount: 0 };
    total.qty += line.qty;
    total.remaining += line.remaining;
    total.returnedAmount += (line.amount * (line.qty - line.remaining)) / line.qty;
    totals.set(line.saleId, total);
  }
  return [...totals.entries()]
    .filter(([, total]) => total.qty - total.remaining > EPSILON)
    .map(([saleId, total]) => ({
      saleId,
      returnedAmount: Math.round(total.returnedAmount * 100) / 100,
      fullyReturned: total.remaining <= EPSILON,
    }));
}
