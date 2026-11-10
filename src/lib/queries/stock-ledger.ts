/**
 * Every row of each barcode's latest stock snapshot (the latest `period_to`, then `period_from`). The Stock
 * Report lists a barcode once per branch it passed through, and a transfer is an In at one branch and an Out
 * at the other, so purchases, sales and closing stock add up across these rows without counting a piece twice.
 * Use as a CTE body: `WITH latest AS (${LATEST_STOCK_ROWS})`. Count barcodes with COUNT(DISTINCT barcode).
 */
export const LATEST_STOCK_ROWS = `
  SELECT ranked.* FROM (
    SELECT vsl.*, rank() OVER (PARTITION BY vsl.barcode ORDER BY vsl.period_to DESC, vsl.period_from DESC) AS snapshot_rank
    FROM vendor_stock_ledger vsl
  ) ranked
  WHERE ranked.snapshot_rank = 1`;
