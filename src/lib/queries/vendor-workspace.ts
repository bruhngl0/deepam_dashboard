/** Query adapter for the vendor workspace's operational screens. */
import { db } from '@/db';
import { sql } from 'drizzle-orm';

type Row = Record<string, unknown>;
async function query(text: string): Promise<Row[]> {
  const result = (await db.execute(sql.raw(text))) as unknown;
  return Array.isArray(result) ? result as Row[] : ((result as { rows?: Row[] }).rows ?? []);
}
const number = (value: unknown) => Number(value ?? 0);

export type VendorWorkspaceRow = {
  id: string; company: string; brand: string; contact: string; phone: string; email: string;
  address: string; city: string; state: string; gstin: string; pan: string; categories: string[];
  purchasedValue: number; purchasedQty: number; soldValue: number; soldQty: number;
  stockValue: number; stockQty: number; agingDays: number; marginPct: number; turnDays: number;
  paymentValue: number; dueDate: string | null; outstanding: number; overdue: number; returnValue: number; returnQty: number; score: number;
};

export async function getVendorWorkspaceRows(): Promise<VendorWorkspaceRow[]> {
  const rows = await query(`
    WITH latest AS (SELECT DISTINCT ON (barcode) * FROM vendor_stock_ledger ORDER BY barcode, period_to DESC),
    ledger AS (SELECT vendor_id, SUM(purc_amt) purchased_value, SUM(purc_qty) purchased_qty, SUM(net_sales_amt) sold_value, SUM(net_sales_qty) sold_qty, SUM(cl_amt) stock_value, SUM(cl_qty) stock_qty FROM latest GROUP BY vendor_id),
    orders AS (SELECT po.vendor_id, SUM(i.return_value) return_value, SUM(i.return_qty) return_qty, MAX(po.purchase_date) last_purchase, SUM(i.qty*i.cost) ordered_value FROM vendor_purchase_orders po JOIN vendor_purchase_items i ON i.purchase_order_id=po.id GROUP BY po.vendor_id),
    payments AS (SELECT vendor_id, SUM(amount) paid, MAX(paid_at) last_paid_at FROM vendor_payments GROUP BY vendor_id),
    due AS (SELECT vendor_id, SUM(i.qty*i.cost) FILTER (WHERE payment_due_date < CURRENT_DATE AND payment_status <> 'paid') overdue FROM vendor_purchase_orders po JOIN vendor_purchase_items i ON i.purchase_order_id=po.id GROUP BY vendor_id)
    SELECT v.id, COALESCE(v.vendor_code, 'VND-' || LPAD(v.id::text, 3, '0')) code, v.name company, COALESCE(v.brand_name,'—') brand, COALESCE(v.contact_person,'—') contact, COALESCE(v.phone,'—') phone, COALESCE(v.email,'—') email, COALESCE(v.address,'—') address, COALESCE(v.city,'—') city, COALESCE(v.state,'—') state, COALESCE(v.gstin,'—') gstin, COALESCE(v.pan,'—') pan, COALESCE(v.category_supplied,'Unclassified') categories,
      COALESCE(l.purchased_value,0) purchased_value, COALESCE(l.purchased_qty,0) purchased_qty, COALESCE(l.sold_value,0) sold_value, COALESCE(l.sold_qty,0) sold_qty, COALESCE(l.stock_value,0) stock_value, COALESCE(l.stock_qty,0) stock_qty, COALESCE(o.return_value,0) return_value, COALESCE(o.return_qty,0) return_qty,
      GREATEST(CURRENT_DATE - COALESCE(o.last_purchase, CURRENT_DATE), 0) aging_days, COALESCE(p.paid,0) payment_value, (SELECT MAX(payment_due_date) FROM vendor_purchase_orders x WHERE x.vendor_id=v.id AND x.payment_status <> 'paid') due_date, COALESCE(o.ordered_value,0)-COALESCE(p.paid,0) outstanding, COALESCE(d.overdue,0) overdue
    FROM vendors v LEFT JOIN ledger l ON l.vendor_id=v.id LEFT JOIN orders o ON o.vendor_id=v.id LEFT JOIN payments p ON p.vendor_id=v.id LEFT JOIN due d ON d.vendor_id=v.id
    ORDER BY purchased_value DESC, v.name`);
  return rows.map((r) => {
    const purchasedValue = number(r.purchased_value), soldValue = number(r.sold_value), stockValue = number(r.stock_value);
    const marginPct = soldValue ? ((soldValue - stockValue * 0.69) / soldValue) * 100 : 0;
    const agingDays = number(r.aging_days);
    return { id: String(r.code), company: String(r.company), brand: String(r.brand), contact: String(r.contact), phone: String(r.phone), email: String(r.email), address: String(r.address), city: String(r.city), state: String(r.state), gstin: String(r.gstin), pan: String(r.pan), categories: String(r.categories).split(',').map((x) => x.trim()), purchasedValue, purchasedQty: number(r.purchased_qty), soldValue, soldQty: number(r.sold_qty), stockValue, stockQty: number(r.stock_qty), agingDays, marginPct, turnDays: stockValue ? Math.round((stockValue / Math.max(soldValue, 1)) * 30) : 0, paymentValue: number(r.payment_value), dueDate: r.due_date ? String(r.due_date) : null, outstanding: number(r.outstanding), overdue: number(r.overdue), returnValue: number(r.return_value), returnQty: number(r.return_qty), score: Math.max(0, Math.min(100, Math.round(55 + Math.min(25, soldValue / Math.max(purchasedValue, 1) * 25) + Math.min(15, marginPct / 3) - Math.min(15, agingDays / 12) - (number(r.overdue) ? 10 : 0)))) };
  });
}

export type VendorCustomerInsight = { vendor: string; category: string; customerId: number | null; customer: string; phone: string; requested: number; fulfilled: number; outstanding: number; opportunity: number; status: string };
export async function getVendorCustomerInsights(): Promise<VendorCustomerInsight[]> {
  const rows = await query(`SELECT v.name vendor, d.category, c.id customer_id, COALESCE(c.full_name,'Unlinked request') customer, COALESCE(c.phone_e164,'—') phone, d.requested_qty requested, d.fulfilled_qty fulfilled, d.expected_revenue opportunity, d.status FROM vendor_customer_demands d LEFT JOIN vendors v ON v.id=d.vendor_id LEFT JOIN customers c ON c.id=d.customer_id ORDER BY d.requested_at DESC, v.name`);
  return rows.map((r) => ({ vendor: String(r.vendor ?? 'Unassigned'), category: String(r.category), customerId: r.customer_id === null ? null : number(r.customer_id), customer: String(r.customer), phone: String(r.phone), requested: number(r.requested), fulfilled: number(r.fulfilled), outstanding: number(r.requested) - number(r.fulfilled), opportunity: number(r.opportunity), status: String(r.status) }));
}

export type DemandRow = { category: string; requested: number; fulfilled: number; lost: number; vendor: string; availability: string; opportunity: number };
export async function getVendorDemandRows(): Promise<DemandRow[]> {
  const rows = await query(`SELECT d.category, COALESCE(v.name,'Unassigned') vendor, SUM(d.requested_qty) requested, SUM(d.fulfilled_qty) fulfilled, SUM(d.expected_revenue) opportunity FROM vendor_customer_demands d LEFT JOIN vendors v ON v.id=d.vendor_id GROUP BY d.category, v.name ORDER BY requested DESC`);
  return rows.map((r) => { const requested = number(r.requested), fulfilled = number(r.fulfilled); return { category: String(r.category), vendor: String(r.vendor), requested, fulfilled, lost: requested - fulfilled, opportunity: number(r.opportunity), availability: fulfilled < requested ? 'Needs replenishment' : 'Available' }; });
}

export type PurchaseOrderRow = { po: string; vendor: string; date: string; category: string; amount: number; status: string };
export async function getRecentVendorPurchaseOrders(): Promise<PurchaseOrderRow[]> {
  const rows = await query(`SELECT po.po_number, v.name vendor, po.purchase_date, COALESCE(po.category,'Unclassified') category, COALESCE(SUM(i.qty*i.cost),0) amount, po.qc_status FROM vendor_purchase_orders po JOIN vendors v ON v.id=po.vendor_id LEFT JOIN vendor_purchase_items i ON i.purchase_order_id=po.id GROUP BY po.id,v.name ORDER BY po.purchase_date DESC LIMIT 8`);
  return rows.map((r) => ({ po: String(r.po_number), vendor: String(r.vendor), date: new Date(String(r.purchase_date)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), category: String(r.category), amount: number(r.amount), status: String(r.qc_status) }));
}

export type PurchaseRegisterRow = {
  poNumber: string; vendor: string; purchaseDate: string; category: string; skuNo: string;
  qty: number; cost: number; mrp: number; receivedDate: string | null; qcStatus: string;
  returnQty: number; returnValue: number; store: string; allocatedQty: number;
};
export async function getVendorPurchaseRegister(): Promise<PurchaseRegisterRow[]> {
  const rows = await query(`
    SELECT po.po_number, v.name vendor, po.purchase_date, COALESCE(po.category,'Unclassified') category,
      i.sku_no, i.qty, i.cost, i.mrp, po.received_date, i.qc_status, i.return_qty, i.return_value,
      COALESCE(s.name,'Unallocated') store, i.allocated_qty
    FROM vendor_purchase_orders po
    JOIN vendors v ON v.id=po.vendor_id
    JOIN vendor_purchase_items i ON i.purchase_order_id=po.id
    LEFT JOIN stores s ON s.id=i.store_id
    ORDER BY po.purchase_date DESC, po.po_number, i.sku_no`);
  return rows.map((r) => ({ poNumber: String(r.po_number), vendor: String(r.vendor), purchaseDate: String(r.purchase_date), category: String(r.category), skuNo: String(r.sku_no), qty: number(r.qty), cost: number(r.cost), mrp: number(r.mrp), receivedDate: r.received_date ? String(r.received_date) : null, qcStatus: String(r.qc_status), returnQty: number(r.return_qty), returnValue: number(r.return_value), store: String(r.store), allocatedQty: number(r.allocated_qty) }));
}
