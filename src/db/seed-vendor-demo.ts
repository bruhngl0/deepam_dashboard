/** Seeds the vendor workspace with repeatable, clearly synthetic records. */
import './load-env';
import { eq, inArray } from 'drizzle-orm';
import { txDb } from './index';
import {
  customers,
  importBatches,
  stores,
  vendorCustomerDemands,
  vendorPayments,
  vendorPurchaseItems,
  vendorPurchaseOrders,
  vendors,
  vendorStockLedger,
} from './schema';

const profiles = [
  ['VND-001', 'Kaveri Silks Private Limited', 'Kaveri Heritage', 'R. Meenakshi', '9845011882', 'orders@kaveriheritage.in', '14 Silk Market Road', 'Bengaluru', 'Karnataka', '29AAECK4812F1ZJ', 'AAECK4812F', 'Silk sarees, Bridal'],
  ['VND-002', 'Nandini Textiles', 'Nandini Weaves', 'P. Arvind', '9886190413', 'arvind@nandiniweaves.in', '42 Devaraja Market', 'Mysuru', 'Karnataka', '29AAFFN7421D1Z4', 'AAFFN7421D', 'Cotton sarees, Dress material'],
  ['VND-003', 'Aarna Handlooms LLP', 'Aarna', 'S. Karthik', '9900522177', 'sales@aarnahandlooms.com', '18 Banjara Hills Road', 'Hyderabad', 'Telangana', '36AAXFA1337M1Z2', 'AAXFA1337M', 'Linen, Handloom'],
  ['VND-004', 'Saanvi Fashions', 'Saanvi Studio', 'N. Priya', '9845380062', 'priya@saanvistudio.in', '9 Ring Road', 'Surat', 'Gujarat', '24AAYFS8752H1ZP', 'AAYFS8752H', 'Occasion wear, Lehengas'],
  ['VND-005', 'Tirupati Fabrics', 'Tirupati', 'V. Suresh', '9731148809', 'dispatch@tirupatifabrics.in', '61 Avinashi Road', 'Coimbatore', 'Tamil Nadu', '33AAFFT3108C1ZF', 'AAFFT3108C', 'Blouse material, Daily wear'],
] as const;

async function main() {
  const { db, pool } = txDb();
  try {
    await db.transaction(async (tx) => {
      for (const [vendorCode, name, brandName, contactPerson, phone, email, address, city, state, gstin, pan, categorySupplied] of profiles) {
        await tx.insert(vendors).values({ vendorCode, name, brandName, contactPerson, phone, email, address, city, state, gstin, pan, categorySupplied })
          .onConflictDoUpdate({ target: vendors.vendorCode, set: { name, brandName, contactPerson, phone, email, address, city, state, gstin, pan, categorySupplied } });
      }
      const vendorRows = await tx.select({ id: vendors.id, code: vendors.vendorCode }).from(vendors).where(inArray(vendors.vendorCode, profiles.map((p) => p[0])));
      const vendorId = new Map(vendorRows.map((v) => [v.code!, v.id]));
      const [ledgerBatch] = await tx.insert(importBatches).values({
        sourceType: 'vendor', sourceKind: 'vendor_stock', fileName: 'synthetic-vendor-ledger.xlsx',
        sheetName: 'Synthetic demo', status: 'committed', rowsTotal: 5, rowsOk: 5, uploadedBy: 'demo-seed', committedAt: new Date(),
      }).returning({ id: importBatches.id });
      const ledgerRows = [
        ['VND-001', 'KAV-SILK-101', 'Kaveri bridal silk', 'Silk sarees', 426, 1842000, 358, 1564800, 68, 384000],
        ['VND-002', 'NAN-COT-310', 'Nandini cotton saree', 'Cotton sarees', 710, 1265000, 574, 1012000, 136, 253000],
        ['VND-003', 'AAR-LIN-220', 'Aarna handloom linen', 'Linen', 384, 982000, 271, 721000, 113, 261000],
        ['VND-004', 'SAA-OCC-510', 'Saanvi occasion lehenga', 'Occasion wear', 202, 1540000, 151, 1183000, 51, 357000],
        ['VND-005', 'TIR-BLS-411', 'Tirupati blouse material', 'Blouse material', 926, 743000, 603, 491000, 323, 252000],
      ] as const;
      for (const [code, barcode, itemName, itemGroupName, purcQty, purcAmt, netSalesQty, netSalesAmt, clQty, clAmt] of ledgerRows) {
        await tx.insert(vendorStockLedger).values({ vendorId: vendorId.get(code)!, batchId: ledgerBatch.id, barcode, itemName, itemGroupName, periodFrom: '2026-01-01', periodTo: '2026-09-17', purcQty: String(purcQty), purcAmt: String(purcAmt), netPurcQty: String(purcQty), netPurcAmt: String(purcAmt), netSalesQty: String(netSalesQty), netSalesAmt: String(netSalesAmt), clQty: String(clQty), clAmt: String(clAmt), clMrp: String(clAmt * 1.45), raw: { synthetic: true } })
          .onConflictDoUpdate({ target: [vendorStockLedger.barcode, vendorStockLedger.periodFrom, vendorStockLedger.periodTo], set: { vendorId: vendorId.get(code)!, batchId: ledgerBatch.id, netSalesQty: String(netSalesQty), netSalesAmt: String(netSalesAmt), clQty: String(clQty), clAmt: String(clAmt) } });
      }
      const [defaultStore] = await tx.select({ id: stores.id }).from(stores).limit(1);
      const poSeed = [
        ['PO-2609-041', 'VND-001', '2026-09-12', 'Silk sarees', '2026-09-15', 'passed', '2026-10-12', 'partial', 'KAV-SILK-101', 'Kaveri bridal silk', 120, 4050, 7200, 120, 'passed', 2, 8100, 118],
        ['PO-2609-039', 'VND-003', '2026-09-09', 'Linen', null, 'pending', '2026-10-09', 'unpaid', 'AAR-LIN-220', 'Aarna handloom linen', 180, 1265, 2290, 0, 'pending', 0, 0, 0],
        ['PO-2609-034', 'VND-002', '2026-09-05', 'Cotton sarees', '2026-09-08', 'passed', '2026-10-05', 'paid', 'NAN-COT-310', 'Nandini cotton saree', 240, 1310, 2490, 240, 'passed', 3, 3930, 237],
        ['PO-2608-022', 'VND-005', '2026-08-21', 'Blouse material', '2026-08-25', 'conditional', '2026-09-20', 'partial', 'TIR-BLS-411', 'Tirupati blouse material', 360, 720, 1290, 360, 'conditional', 18, 12960, 342],
        ['PO-2608-018', 'VND-004', '2026-08-14', 'Occasion wear', '2026-08-18', 'passed', '2026-09-14', 'paid', 'SAA-OCC-510', 'Saanvi occasion lehenga', 75, 6100, 10990, 75, 'passed', 1, 6100, 74],
      ] as const;
      for (const po of poSeed) {
        const [poNumber, code, purchaseDate, category, receivedDate, qcStatus, paymentDueDate, paymentStatus, skuNo, itemName, qty, cost, mrp, receivedQty, itemQc, returnQty, returnValue, allocatedQty] = po;
        const [order] = await tx.insert(vendorPurchaseOrders).values({ poNumber, vendorId: vendorId.get(code)!, purchaseDate, category, receivedDate, qcStatus, paymentDueDate, paymentStatus })
          .onConflictDoUpdate({ target: vendorPurchaseOrders.poNumber, set: { receivedDate, qcStatus, paymentDueDate, paymentStatus } }).returning({ id: vendorPurchaseOrders.id });
        const existing = await tx.select({ id: vendorPurchaseItems.id }).from(vendorPurchaseItems).where(eq(vendorPurchaseItems.purchaseOrderId, order.id)).limit(1);
        const values = { purchaseOrderId: order.id, skuNo, itemName, qty: String(qty), cost: String(cost), mrp: String(mrp), receivedQty: String(receivedQty), qcStatus: itemQc, returnQty: String(returnQty), returnValue: String(returnValue), storeId: defaultStore?.id, allocatedQty: String(allocatedQty) };
        if (existing[0]) await tx.update(vendorPurchaseItems).set(values).where(eq(vendorPurchaseItems.id, existing[0].id)); else await tx.insert(vendorPurchaseItems).values(values);
      }
      const orders = await tx.select({ id: vendorPurchaseOrders.id, number: vendorPurchaseOrders.poNumber }).from(vendorPurchaseOrders).where(inArray(vendorPurchaseOrders.poNumber, poSeed.map((p) => p[0])));
      const poId = new Map(orders.map((p) => [p.number, p.id]));
      const payments = [['VND-001', 'PO-2609-041', '2026-09-16', 240000, 'UTR-KAV-0916'], ['VND-002', 'PO-2609-034', '2026-09-09', 314400, 'UTR-NAN-0909'], ['VND-004', 'PO-2608-018', '2026-08-20', 457500, 'UTR-SAA-0820'], ['VND-005', 'PO-2608-022', '2026-08-28', 130000, 'UTR-TIR-0828']] as const;
      for (const [code, poNumber, paidAt, amount, reference] of payments) await tx.insert(vendorPayments).values({ vendorId: vendorId.get(code)!, purchaseOrderId: poId.get(poNumber), paidAt, amount: String(amount), reference }).onConflictDoNothing();
      const people = await tx.select({ id: customers.id }).from(customers).limit(5);
      await tx.delete(vendorCustomerDemands).where(inArray(vendorCustomerDemands.category, ['Linen', 'Cotton sarees', 'Silk sarees', 'Blouse material', 'Occasion wear']));
      const demands = [['VND-003', 'Linen', 86, 51, 186000, 'open'], ['VND-002', 'Cotton sarees', 142, 121, 84000, 'partially_fulfilled'], ['VND-001', 'Silk sarees', 118, 110, 64000, 'partially_fulfilled'], ['VND-005', 'Blouse material', 164, 101, 126000, 'open'], ['VND-004', 'Occasion wear', 74, 68, 72000, 'partially_fulfilled']] as const;
      for (const [i, [code, category, requestedQty, fulfilledQty, expectedRevenue, status]] of demands.entries()) await tx.insert(vendorCustomerDemands).values({ customerId: people[i]?.id, vendorId: vendorId.get(code), category, requestedQty: String(requestedQty), fulfilledQty: String(fulfilledQty), expectedRevenue: String(expectedRevenue), status, requestedAt: '2026-09-17', notes: 'Synthetic seed demand' });
    });
    console.log('Vendor demo data seeded.');
  } finally { await pool.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
