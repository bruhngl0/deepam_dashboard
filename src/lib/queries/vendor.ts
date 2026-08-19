/**
 * Vendor module metric queries — stock ledger + item-level sales.
 *
 * Follows `lib/queries/dashboard.ts`'s shape: a raw-`sql`-tag `query()`
 * helper, injection boundary only through `parseDateParam` (reused from
 * dashboard.ts, not re-implemented), typed return objects.
 *
 * `vendor_stock_ledger` is a periodic snapshot, not a per-event stream — a
 * barcode can have several `(period_from, period_to)` rows as later exports
 * extend the same fiscal-year-to-date window. Every ledger-based query below
 * reads only the *latest* snapshot per barcode (`latest_ledger`, ranked by
 * `period_to`), the same reasoning `getCustomerValueTiers` in dashboard.ts
 * gives for not taking a `DateRange` at all: re-ranking a lifetime/point-in-
 * time figure inside an arbitrary window doesn't have a stable meaning.
 * `sale_line_items` is event-level, so the margin and coverage queries do
 * take a `DateRange`, bounding `voucher_date_raw`.
 *
 * Margin figures (`getMarginByVendor`, `getMarginByItem`) are approximate:
 * `sale_line_items.purc_value` is the cost basis printed on the bill at the
 * time of that sale, not the vendor ledger's own `purc_amt` — the two files
 * snapshot cost at different times and are never reconciled against each
 * other here.
 */

import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { type DateRange, parseDateParam } from './dashboard';

type Row = Record<string, unknown>;

async function query(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? (result as Row[]) : ((result as { rows: Row[] }).rows ?? []);
}

/**
 * `AND <alias>.voucher_date_raw ...` fragment, or `''` when unbounded.
 * `voucher_date_raw` is a `date` column (not a timestamp), so `to` is
 * inclusive with a plain `<=` rather than the next-day trick
 * `dateCondition` in dashboard.ts uses for `billed_at`.
 */
function voucherDateCondition(alias: string, range: DateRange): string {
  const from = parseDateParam(range.from);
  const to = parseDateParam(range.to);
  const parts: string[] = [];
  if (from) parts.push(`${alias}.voucher_date_raw >= '${from}'`);
  if (to) parts.push(`${alias}.voucher_date_raw <= '${to}'`);
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

/** The most recent `(period_from, period_to)` snapshot per barcode. */
const LATEST_LEDGER = `
  latest_ledger AS (
    SELECT DISTINCT ON (vsl.barcode) vsl.*
    FROM   vendor_stock_ledger vsl
    ORDER  BY vsl.barcode, vsl.period_to DESC
  )
`;

export interface VendorKpis {
  purchaseAmount: number;
  netSalesAmount: number;
  closingValue: number;
  sellThroughPct: number;
  vendorCount: number;
  barcodeCount: number;
}

/** Business-wide totals over the latest snapshot of every tracked barcode. */
export async function getVendorKpis(): Promise<VendorKpis> {
  const [row] = await query(`
    WITH ${LATEST_LEDGER}
    SELECT
      COALESCE(SUM(purc_amt), 0)::numeric      AS purchase_amount,
      COALESCE(SUM(net_sales_amt), 0)::numeric AS net_sales_amount,
      COALESCE(SUM(cl_amt), 0)::numeric        AS closing_value,
      COUNT(DISTINCT vendor_id)::int           AS vendor_count,
      COUNT(*)::int                            AS barcode_count
    FROM latest_ledger`);

  const purchaseAmount = Number(row.purchase_amount ?? 0);
  const netSalesAmount = Number(row.net_sales_amount ?? 0);

  return {
    purchaseAmount,
    netSalesAmount,
    closingValue: Number(row.closing_value ?? 0),
    sellThroughPct: purchaseAmount ? (100 * netSalesAmount) / purchaseAmount : 0,
    vendorCount: Number(row.vendor_count ?? 0),
    barcodeCount: Number(row.barcode_count ?? 0),
  };
}

export interface VendorBreakdownRow {
  vendorName: string;
  purchaseAmount: number;
  netSalesAmount: number;
  closingValue: number;
  sellThroughPct: number;
  barcodeCount: number;
}

/** Per-vendor rollup for a sortable table. */
export async function getVendorBreakdown(): Promise<VendorBreakdownRow[]> {
  const rows = await query(`
    WITH ${LATEST_LEDGER}
    SELECT v.name                               AS vendor_name,
           COALESCE(SUM(ll.purc_amt), 0)::numeric      AS purchase_amount,
           COALESCE(SUM(ll.net_sales_amt), 0)::numeric AS net_sales_amount,
           COALESCE(SUM(ll.cl_amt), 0)::numeric        AS closing_value,
           COUNT(*)::int                        AS barcode_count
    FROM   latest_ledger ll
    JOIN   vendors v ON v.id = ll.vendor_id
    GROUP  BY v.name
    ORDER  BY purchase_amount DESC`);

  return rows.map((r) => {
    const purchaseAmount = Number(r.purchase_amount ?? 0);
    const netSalesAmount = Number(r.net_sales_amount ?? 0);
    return {
      vendorName: String(r.vendor_name),
      purchaseAmount,
      netSalesAmount,
      closingValue: Number(r.closing_value ?? 0),
      sellThroughPct: purchaseAmount ? (100 * netSalesAmount) / purchaseAmount : 0,
      barcodeCount: Number(r.barcode_count ?? 0),
    };
  });
}

export interface ItemGroupBreakdownRow {
  itemGroupName: string;
  purchaseAmount: number;
  netSalesAmount: number;
  closingValue: number;
  sellThroughPct: number;
  barcodeCount: number;
}

/** Per-item-group rollup (`ART - POLYSTERS`, `MYSORE SILK`, …). */
export async function getItemGroupBreakdown(): Promise<ItemGroupBreakdownRow[]> {
  const rows = await query(`
    WITH ${LATEST_LEDGER}
    SELECT COALESCE(item_group_name, 'Unclassified') AS item_group_name,
           COALESCE(SUM(purc_amt), 0)::numeric      AS purchase_amount,
           COALESCE(SUM(net_sales_amt), 0)::numeric AS net_sales_amount,
           COALESCE(SUM(cl_amt), 0)::numeric        AS closing_value,
           COUNT(*)::int                            AS barcode_count
    FROM   latest_ledger
    GROUP  BY 1
    ORDER  BY purchase_amount DESC`);

  return rows.map((r) => {
    const purchaseAmount = Number(r.purchase_amount ?? 0);
    const netSalesAmount = Number(r.net_sales_amount ?? 0);
    return {
      itemGroupName: String(r.item_group_name),
      purchaseAmount,
      netSalesAmount,
      closingValue: Number(r.closing_value ?? 0),
      sellThroughPct: purchaseAmount ? (100 * netSalesAmount) / purchaseAmount : 0,
      barcodeCount: Number(r.barcode_count ?? 0),
    };
  });
}

/** Barcode → vendor, resolved from the latest ledger snapshot. */
const ITEM_VENDOR = `
  item_vendor AS (
    SELECT DISTINCT ON (vsl.barcode) vsl.barcode, vsl.vendor_id
    FROM   vendor_stock_ledger vsl
    ORDER  BY vsl.barcode, vsl.period_to DESC
  )
`;

export interface MarginByVendorRow {
  vendorName: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
  lineCount: number;
}

/** Approximate margin per vendor — see module note on cost-basis timing. */
export async function getMarginByVendor(range: DateRange = {}): Promise<MarginByVendorRow[]> {
  const rows = await query(`
    WITH ${ITEM_VENDOR}
    SELECT v.name                                                        AS vendor_name,
           COALESCE(SUM(sli.sales_amt), 0)::numeric                      AS revenue,
           COALESCE(SUM(sli.purc_value * sli.qty), 0)::numeric           AS cost,
           COUNT(*)::int                                                 AS line_count
    FROM   sale_line_items sli
    JOIN   item_vendor iv ON iv.barcode = sli.barcode
    JOIN   vendors v ON v.id = iv.vendor_id
    WHERE  true${voucherDateCondition('sli', range)}
    GROUP  BY v.name
    ORDER  BY revenue DESC`);

  return rows.map((r) => {
    const revenue = Number(r.revenue ?? 0);
    const cost = Number(r.cost ?? 0);
    const margin = revenue - cost;
    return {
      vendorName: String(r.vendor_name),
      revenue,
      cost,
      margin,
      marginPct: revenue ? (100 * margin) / revenue : 0,
      lineCount: Number(r.line_count ?? 0),
    };
  });
}

export interface MarginByItemRow {
  barcode: string;
  itemName: string | null;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
  lineCount: number;
}

/** Approximate margin per barcode — see module note on cost-basis timing. Top 200 by revenue. */
export async function getMarginByItem(range: DateRange = {}): Promise<MarginByItemRow[]> {
  const rows = await query(`
    SELECT sli.barcode,
           MAX(sli.item_name)                                  AS item_name,
           COALESCE(SUM(sli.sales_amt), 0)::numeric             AS revenue,
           COALESCE(SUM(sli.purc_value * sli.qty), 0)::numeric  AS cost,
           COUNT(*)::int                                        AS line_count
    FROM   sale_line_items sli
    WHERE  true${voucherDateCondition('sli', range)}
    GROUP  BY sli.barcode
    ORDER  BY revenue DESC
    LIMIT  200`);

  return rows.map((r) => {
    const revenue = Number(r.revenue ?? 0);
    const cost = Number(r.cost ?? 0);
    const margin = revenue - cost;
    return {
      barcode: String(r.barcode),
      itemName: r.item_name ? String(r.item_name) : null,
      revenue,
      cost,
      margin,
      marginPct: revenue ? (100 * margin) / revenue : 0,
      lineCount: Number(r.line_count ?? 0),
    };
  });
}

export interface DeadStockRow {
  barcode: string;
  itemName: string | null;
  vendorName: string;
  purcQty: number;
  netSalesQty: number;
  clQty: number;
  clAmt: number;
}

/**
 * Barcodes that were bought but essentially never sold and still carry
 * closing stock — a purchase quantity greater than zero, net sales quantity
 * at or below zero, and a positive closing quantity. Top 100 by closing value.
 */
export async function getDeadStock(): Promise<DeadStockRow[]> {
  const rows = await query(`
    WITH ${LATEST_LEDGER}
    SELECT ll.barcode, ll.item_name, v.name AS vendor_name,
           COALESCE(ll.purc_qty, 0)::numeric      AS purc_qty,
           COALESCE(ll.net_sales_qty, 0)::numeric AS net_sales_qty,
           COALESCE(ll.cl_qty, 0)::numeric        AS cl_qty,
           COALESCE(ll.cl_amt, 0)::numeric        AS cl_amt
    FROM   latest_ledger ll
    JOIN   vendors v ON v.id = ll.vendor_id
    WHERE  COALESCE(ll.purc_qty, 0) > 0
      AND  COALESCE(ll.net_sales_qty, 0) <= 0
      AND  COALESCE(ll.cl_qty, 0) > 0
    ORDER  BY cl_amt DESC
    LIMIT  100`);

  return rows.map((r) => ({
    barcode: String(r.barcode),
    itemName: r.item_name ? String(r.item_name) : null,
    vendorName: String(r.vendor_name),
    purcQty: Number(r.purc_qty ?? 0),
    netSalesQty: Number(r.net_sales_qty ?? 0),
    clQty: Number(r.cl_qty ?? 0),
    clAmt: Number(r.cl_amt ?? 0),
  }));
}

export interface SaleLineItemCoverage {
  matchedLines: number;
  unmatchedLines: number;
  matchedAmount: number;
  unmatchedAmount: number;
}

/** Matched vs. unmatched item-level sale lines — the vendor module's data-quality panel (D-56 spirit). */
export async function getSaleLineItemCoverage(): Promise<SaleLineItemCoverage> {
  const [row] = await query(`
    SELECT
      COUNT(*) FILTER (WHERE sale_id IS NOT NULL)::int                       AS matched_n,
      COUNT(*) FILTER (WHERE sale_id IS NULL)::int                           AS unmatched_n,
      COALESCE(SUM(sales_amt) FILTER (WHERE sale_id IS NOT NULL), 0)::numeric AS matched_amt,
      COALESCE(SUM(sales_amt) FILTER (WHERE sale_id IS NULL), 0)::numeric    AS unmatched_amt
    FROM sale_line_items`);

  return {
    matchedLines: Number(row.matched_n ?? 0),
    unmatchedLines: Number(row.unmatched_n ?? 0),
    matchedAmount: Number(row.matched_amt ?? 0),
    unmatchedAmount: Number(row.unmatched_amt ?? 0),
  };
}

export type { DateRange };
