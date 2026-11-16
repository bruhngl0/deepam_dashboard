import { requireApiUser } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { MONTH } from '@/lib/partners/constants';
import { payoutLines } from '@/lib/partners/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const istDay = (v: unknown) => (v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(String(v))) : '');

/** Every commission line in a month's payout cycle, for accounts. */
export async function GET(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  const month = new URL(request.url).searchParams.get('month') ?? '';
  if (!MONTH.test(month)) return new Response('month=YYYY-MM is required', { status: 400 });
  const rows = await payoutLines(month);
  const csv = toCsv(
    ['Partner ID', 'Partner', 'Category', 'Customer', 'Customer ID', 'Bill', 'Store', 'Bill date', 'Bill amount', 'Level', 'Commission %', 'Commission', 'Status', 'Paid on', 'Payment reference'],
    rows.map((r) => [r.partner_code, r.partner_name, r.category, r.customer_name, r.customer_code, r.voucher_no, r.store, istDay(r.billed_at), r.bill_amount,
      r.level, r.commission_percent, r.commission_amount, r.status, istDay(r.paid_at), r.payout_reference]),
  );
  return new Response(`﻿${csv}`, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="partner-payouts-${month}.csv"` },
  });
}
