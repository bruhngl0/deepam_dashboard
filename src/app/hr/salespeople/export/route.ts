/**
 * CSV for incentive work: every salesperson's figures (/hr/salespeople), or one salesperson's bills (?emp=DBYA0019, the Employee ID),
 * for the same ?from=&to=&store= as the page. Plain figures (no currency symbols) so a spreadsheet can add them up.
 */

import { requireApiUser } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { billOnlyPhoneLabel } from '@/lib/phone';
import { salesPeriod, salespersonBills, salespersonStats } from '@/lib/analytics/salesperson-module';
import { employeesBySalesperson, resolveSalesperson } from '@/lib/hr/employees';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const round = (v: number) => Math.round(v * 100) / 100;

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const period = salesPeriod(Object.fromEntries(params));
  const who = params.get('emp') ? await resolveSalesperson(params.get('emp')!.toUpperCase()) : null;
  const stamp = `${period.from === '2000-01-01' ? 'all' : period.from}_to_${period.to}${period.store ? `_${period.store.replaceAll(',', '+')}` : ''}`;

  let csv: string;
  let name: string;
  if (who) {
    const { rows } = await salespersonBills(who.key, period, 0);
    csv = toCsv(
      ['Date', 'Bill', 'Store', 'Customer ID', 'Customer', 'Customer phone note', 'New customer', 'Items', 'Qty', 'Amount', 'Discount', 'Purchase value'],
      rows.map((b) => [b.day, b.voucher?.split('@')[0] ?? '', b.storeName ?? '', b.customerCode ?? '', b.customerName ?? '', billOnlyPhoneLabel(b.customerPhone) ?? '', b.firstBill && b.amount > 0 ? 'yes' : '',
        b.items, round(b.qty), round(b.amount), round(b.discount), b.cost === null ? '' : round(b.cost)]),
    );
    name = `${who.employee?.employeeCode ?? 'salesperson'}-bills-${stamp}.csv`;
  } else {
    const [rows, ids] = await Promise.all([salespersonStats(period).then((r) => r ?? []), employeesBySalesperson()]);
    csv = toCsv(
      ['Employee ID', 'Name', 'Store', 'Bills', 'Sales before returns', 'Returns', 'Returned value', 'Net sales', 'Items', 'Discount', 'Sales with known cost', 'Purchase value',
        'Customers', 'Bills with customer', 'New customers', 'Came back', 'Walk-ins served', 'Shared walk-ins', 'Walk-ins converted',
        'Driver visits', 'Driver bills', 'Driver sales', 'Calls', 'Connected calls', 'Interested'],
      rows.map((r) => [ids.get(r.empCode)?.employeeCode ?? '', ids.get(r.empCode)?.fullName ?? r.name, r.storeName ?? r.storeCode ?? '', r.bills, round(r.grossSales), r.returns, round(r.returned), round(r.netSales), round(r.qty),
        round(r.discount), round(r.salesWithCost), round(r.cost), r.customers, r.billsWithCustomer, r.newCustomers, r.repeatCustomers, r.walkIns, r.walkInsShared, r.walkInsConverted,
        r.driverVisits, r.driverBills, round(r.driverSales), r.calls, r.connected, r.interested]),
    );
    name = `salespeople-${stamp}.csv`;
  }
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });
}
