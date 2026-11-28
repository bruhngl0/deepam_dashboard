/**
 * The KPIs each module shows on its own overview, for the master Overview (/flow).
 * CRM's modules use the same queries and formulas as their pages. Driver, Store, Vendor and Cash
 * are read from each app's /api/integration/overview, so those apps stay the source of truth.
 * A module that cannot be reached returns null and the rest of the page still renders.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { aq } from '@/lib/analytics/db';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '@/lib/format';
import { listEmployees, type Employee } from '@/lib/hr/employees';
import { monthIncentives } from '@/lib/incentives/store';
import { getOverviewFeed } from '@/lib/integration/apps';
import { filterLeads, metrics } from '@/lib/marketing/local';
import { leadTypeConversions } from '@/lib/marketing/lead-type-conversions-store';
import { loadDataset } from '@/lib/marketing/store';
import { getKpis, getOnlineCustomers } from '@/lib/queries/dashboard';
import { getNewCustomerSummary } from '@/lib/queries/new-customers';
import type { OverviewKey, OverviewKpi } from './modules';

export type Period = { from: string; to: string; allDates?: boolean };

const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []));
const onPayroll = (e: Employee) => e.status === 'Active' || e.status === 'On leave';
const rupees = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

async function hrKpis({ from, to }: Period): Promise<OverviewKpi[]> {
  const month = to.slice(0, 7);
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const employees = await listEmployees();
  const codes = employees.map((e) => e.employeeCode);
  const [attendance, sales, incentives] = await Promise.all([
    codes.length ? db.execute(sql`
      SELECT sum(CASE status WHEN 'Present' THEN 1 WHEN 'Half day' THEN 0.5 ELSE 0 END) AS present,
             count(*) FILTER (WHERE status NOT IN ('Week off', 'Holiday')) AS counted
      FROM attendance_days WHERE day BETWEEN ${from} AND ${to} AND employee_code = ANY(string_to_array(${codes.join(',')}, ','))`)
      .then((r) => rowsOf<{ present: string | null; counted: string }>(r)[0]) : Promise.resolve(undefined),
    aq<{ net: string | null }>('SELECT sum(amount) AS net FROM analytics.fact_bill b WHERE day BETWEEN $1 AND $2', [from, to]),
    monthIncentives(month).catch(() => null),
  ]);
  const present = Number(attendance?.present ?? 0), counted = Number(attendance?.counted ?? 0);
  const payroll = employees.filter(onPayroll);
  const withCtc = payroll.filter((e) => e.monthlyCtc !== null);
  const ctc = withCtc.reduce((s, e) => s + (e.monthlyCtc ?? 0), 0);
  const between = (d: string | null | undefined) => !!d && d >= from && d <= to;
  const netSales = sales ? Number(sales[0]?.net ?? 0) : null;
  const incentiveTotal = incentives ? incentives.reduce((s, r) => s + r.total, 0) : null;
  return [
    { label: 'Total employees', value: formatNumber(payroll.length), caption: `${formatNumber(employees.filter((e) => e.status === 'Active').length)} active` },
    { label: 'Monthly payroll', value: withCtc.length ? formatCurrencyCompact(ctc) : '—', caption: `CTC entered for ${formatNumber(withCtc.length)} of ${formatNumber(payroll.length)}` },
    { label: 'Attendance', value: counted ? formatPercent(present, counted) : '—', caption: counted ? `${formatNumber(present)} of ${formatNumber(counted)} working days` : 'No attendance yet' },
    { label: 'Sales per employee', value: netSales !== null && payroll.length ? formatCurrencyCompact(netSales / payroll.length) : '—', caption: netSales !== null ? `${formatCurrencyCompact(netSales)} net sales` : 'Sales data not connected here' },
    { label: 'Employees on leave', value: formatNumber(employees.filter((e) => e.status === 'On leave').length) },
    { label: `Incentives payable · ${monthLabel}`, value: incentiveTotal !== null ? formatCurrency(incentiveTotal) : '—', caption: 'For the month the period ends in' },
    { label: 'New employees', value: formatNumber(employees.filter((e) => between(e.joiningDate)).length) },
    { label: 'Exits', value: formatNumber(employees.filter((e) => between(e.exitDate)).length) },
  ];
}

async function customerKpis({ from, to }: Period): Promise<OverviewKpi[]> {
  const range = { from, to, store: null };
  const [k, fresh, online] = await Promise.all([getKpis(range), getNewCustomerSummary(range), getOnlineCustomers(range)]);
  const average = k.totalBills ? k.grossSales / k.totalBills : 0;
  return [
    { label: 'Total sales', value: formatCurrencyCompact(k.grossSales), caption: `${formatCurrency(k.grossSales)} · ${formatNumber(k.totalBills)} bills` },
    { label: 'Average bill value', value: formatCurrencyCompact(average), caption: `${formatCurrency(average)} per bill` },
    { label: 'Total customers', value: formatNumber(k.totalCustomers), caption: 'Loyalty customers plus new customers' },
    { label: 'Historical customers', value: formatNumber(k.existingPeople), caption: 'People on the loyalty customer sheet' },
    { label: 'Reactivated customers', value: formatNumber(k.existingBuyers), caption: `${formatCurrencyCompact(k.existingRevenue)} in sales` },
    { label: 'New customers', value: formatNumber(fresh.all.buyers), caption: `${formatNumber(fresh.all.bills)} bills · ${formatCurrencyCompact(fresh.all.sales)} in sales` },
    { label: 'Online customers', value: formatNumber(online.customers), caption: `${formatNumber(online.bills)} bills · ${formatCurrencyCompact(online.sales)} online sales` },
  ];
}

async function marketingKpis({ from, to, allDates }: Period): Promise<OverviewKpi[]> {
  const { data } = await loadDataset();
  const leads = filterLeads(data.leads, { from: allDates ? '' : from, to: allDates ? '' : to, store: '', source: '', search: '' });
  const stats = metrics(data, leads);
  // Spend is recorded by campaign, not by day, so like the module it only shows across all dates.
  const conversions = allDates ? await leadTypeConversions().catch(() => null) : null;
  const spend = conversions && !conversions.spendError ? conversions.spend.reduce((sum, row) => sum + row.spend, 0) : null;
  const note = allDates ? undefined : 'Recorded by campaign: use All dates';
  const per = (count: number) => (spend === null || !count ? '—' : rupees(spend / count));
  return [
    { label: 'Total marketing spend', value: spend === null ? '—' : rupees(spend), caption: note },
    { label: 'Total leads', value: stats.total.toLocaleString('en-IN') },
    { label: 'Cost per lead', value: per(stats.total), caption: note },
    { label: 'Converted leads', value: stats.converted.toLocaleString('en-IN') },
    { label: 'Sales generated', value: rupees(stats.revenue) },
    { label: 'CAC', value: per(stats.converted), caption: note },
    { label: 'ROAS', value: spend ? `${(stats.revenue / spend).toFixed(2)}×` : '—', caption: note },
  ];
}

const feed = (url: string | undefined, token: string | undefined, name: string, { from, to }: Period) =>
  getOverviewFeed(url, token, `/api/integration/overview?from=${from}&to=${to}`, name);

const loaders: Record<OverviewKey, (p: Period) => Promise<OverviewKpi[] | null>> = {
  hr: hrKpis,
  customer: customerKpis,
  marketing: marketingKpis,
  vendor: (p) => feed(process.env.VENDOR_URL, process.env.INTEGRATION_API_TOKEN, 'vendor', p),
  driver: (p) => feed(process.env.RC_URL, process.env.RC_INTEGRATION_TOKEN, 'driver', p),
  store: (p) => feed(process.env.WALKTRACK_URL ?? 'https://na8yspyqqp.ap-south-1.awsapprunner.com', process.env.INTEGRATION_API_TOKEN, 'store', p),
  cash: (p) => feed(process.env.HEMPARSHWA_URL, process.env.HEMPARSHWA_INTEGRATION_TOKEN, 'cash', p),
};

export async function loadModuleKpis(key: OverviewKey, period: Period) {
  try {
    return await loaders[key](period);
  } catch (error) {
    console.warn(`[overview ${key}]`, error instanceof Error ? error.message : error);
    return null;
  }
}
