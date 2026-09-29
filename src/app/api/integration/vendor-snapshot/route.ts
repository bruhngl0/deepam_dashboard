import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { isIntegrationAuthorized } from '@/lib/integration/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const resultRows = (result: unknown) => Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;

export async function GET(request: Request) {
  if (!isIntegrationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const [vendors, products, stockUnits, dailySales] = await Promise.all([
    db.execute(sql`WITH latest AS (SELECT DISTINCT ON (barcode) * FROM vendor_stock_ledger ORDER BY barcode, period_to DESC)
      SELECT v.name AS brand, COALESCE(SUM(l.purc_qty),0)::float8 AS purchase_qty,
        COALESCE(SUM(l.purc_amt),0)::float8 AS purchase_value, COALESCE(SUM(l.net_sales_amt),0)::float8 AS purchase_total,
        COALESCE(SUM(l.cl_qty),0)::float8 AS stock_qty, COALESCE(SUM(l.cl_amt)/NULLIF(SUM(l.cl_qty),0),0)::float8 AS avg_cost,
        COALESCE(SUM(l.cl_mrp)/NULLIF(SUM(l.cl_qty),0),0)::float8 AS avg_mrp,
        COALESCE(SUM(l.cl_amt),0)::float8 AS stock_cost_est, COALESCE(SUM(l.cl_mrp),0)::float8 AS stock_mrp_est
      FROM latest l JOIN vendors v ON v.id=l.vendor_id GROUP BY v.id,v.name ORDER BY v.name`),
    db.execute(sql`WITH latest AS (SELECT DISTINCT ON (barcode) * FROM vendor_stock_ledger ORDER BY barcode, period_to DESC)
      SELECT v.name AS brand, COALESCE(l.item_name,'Unclassified') AS name, COALESCE(SUM(l.net_sales_qty),0)::float8 AS quantity,
        COALESCE(SUM(l.net_sales_amt),0)::float8 AS sales_value, COALESCE(SUM(l.net_purc_amt),0)::float8 AS cost_value,
        COALESCE(SUM(l.net_purc_amt)/NULLIF(SUM(l.net_purc_qty),0),0)::float8 AS unit_cost,
        COALESCE(SUM(l.cl_mrp)/NULLIF(SUM(l.cl_qty),0),0)::float8 AS mrp
      FROM latest l JOIN vendors v ON v.id=l.vendor_id GROUP BY v.name,l.item_name`),
    db.execute(sql`WITH latest AS (SELECT DISTINCT ON (barcode) * FROM vendor_stock_ledger ORDER BY barcode, period_to DESC)
      SELECT v.name AS brand, COALESCE(l.item_name,'Unclassified') AS name, l.barcode, COALESCE(l.cl_qty,0)::float8 AS quantity,
        COALESCE(l.cl_amt/NULLIF(l.cl_qty,0),0)::float8 AS purchase_cost, COALESCE(l.cl_mrp/NULLIF(l.cl_qty,0),0)::float8 AS mrp,
        COALESCE(l.net_sales_amt/NULLIF(l.net_sales_qty,0),0)::float8 AS sales_rate, l.comp_size AS design_no, l.period_to::text AS inward_date
      FROM latest l JOIN vendors v ON v.id=l.vendor_id ORDER BY v.name,l.item_name,l.barcode`),
    db.execute(sql`WITH item_vendor AS (SELECT DISTINCT ON (barcode) barcode,vendor_id FROM vendor_stock_ledger ORDER BY barcode,period_to DESC)
      SELECT sli.voucher_date_raw::text AS sale_date, v.name AS brand, COALESCE(SUM(sli.qty),0)::float8 AS quantity,
        COALESCE(SUM(sli.sales_amt),0)::float8 AS sales_value, COALESCE(SUM(sli.purc_value*sli.qty),0)::float8 AS cost_value,
        COALESCE(SUM(sli.item_disc_amt),0)::float8 AS discount
      FROM sale_line_items sli JOIN item_vendor iv ON iv.barcode=sli.barcode JOIN vendors v ON v.id=iv.vendor_id
      GROUP BY sli.voucher_date_raw,v.name ORDER BY sli.voucher_date_raw,v.name`),
  ]);
  return Response.json({ generatedAt: new Date().toISOString(), vendors: resultRows(vendors), products: resultRows(products), stockUnits: resultRows(stockUnits), dailySales: resultRows(dailySales) });
}
