/**
 * CSV for incentive work: every salesperson's figures (/crm/salespeople), or one salesperson's bills (?emp=EMP-0017),
 * for the same ?from=&to=&store= as the page. Plain figures (no currency symbols) so a spreadsheet can add them up.
 */

import { requireApiUser } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { salesPeriod, salespersonBills, salespersonStats } from '@/lib/analytics/salesperson-module';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const round = (v: number) => Math.round(v * 100) / 100;

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const period = salesPeriod(Object.fromEntries(params));
  const emp = params.get('emp');
  const stamp = `${period.from === '2000-01-01' ? 'all' : period.from}_to_${period.to}${period.store ? `_${period.store}` : ''}`;

  let csv: string;
  let name: string;
  if (emp && /^EMP-\d{4}$/.test(emp)) {
    const { rows } = await salespersonBills(emp, period, 0);
    csv = toCsv(
      ['Date', 'Bill', 'Store', 'Customer ID', 'Customer', 'New customer', 'Items', 'Qty', 'Amount', 'Discount', 'Purchase value', 'Served by (walk-in)', 'Lead source', 'Driver'],
      rows.map((b) => [b.day, b.voucher?.split('@')[0] ?? '', b.storeName ?? '', b.customerCode ?? '', b.customerName ?? '', b.firstBill && b.amount > 0 ? 'yes' : '',
        b.items, round(b.qty), round(b.amount), round(b.discount), b.cost === null ? '' : round(b.cost), b.servedBy ?? '', b.leadChannel ?? '', b.driverCode ?? '']),
    );
    name = `${emp}-bills-${stamp}.csv`;
  } else {
    const rows = (await salespersonStats(period)) ?? [];
    csv = toCsv(
      ['Salesperson ID', 'Name', 'Store', 'Bills', 'Sales before returns', 'Returns', 'Returned value', 'Net sales', 'Items', 'Discount', 'Sales with known cost', 'Purchase value',
        'Customers', 'Bills with customer', 'New customers', 'Came back', 'Walk-ins served', 'Shared walk-ins', 'Walk-ins converted', 'Walk-ins billed', 'Sales from walk-ins',
        'Driver visits', 'Driver bills', 'Driver sales', 'Calls', 'Connected calls', 'Interested'],
      rows.map((r) => [r.empCode, r.name, r.storeName ?? r.storeCode ?? '', r.bills, round(r.grossSales), r.returns, round(r.returned), round(r.netSales), round(r.qty),
        round(r.discount), round(r.salesWithCost), round(r.cost), r.customers, r.billsWithCustomer, r.newCustomers, r.repeatCustomers, r.walkIns, r.walkInsShared, r.walkInsConverted,
        r.walkInsBilled, round(r.walkInSales), r.driverVisits, r.driverBills, round(r.driverSales), r.calls, r.connected, r.interested]),
    );
    name = `salespeople-${stamp}.csv`;
  }
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });
}
