/** The modules on the Overview, in header order. `gate` is the module password that opens it; null is admin only. */

const go = (url: string) => `/__gate/go?to=${encodeURIComponent(url)}`;

export const OVERVIEW_MODULES = [
  { key: 'hr', label: 'HR Intelligence', href: '/hr', gate: 'hr', headline: ['Total employees', 'Monthly payroll', 'Attendance', 'Sales per employee'] },
  { key: 'customer', label: 'Customer Intelligence', href: '/crm', gate: 'customer', headline: ['Total sales', 'Average bill value', 'New customers', 'Reactivated customers'] },
  { key: 'vendor', label: 'Vendor Intelligence', href: go('https://vendor.hemparshwa.com/'), gate: 'vendor', headline: ['Total sales', 'Gross profit', 'Inventory cost', 'Sell-through'] },
  { key: 'driver', label: 'Driver Network Management', href: go('https://rc.hemparshwa.com/driver-dashboard'), gate: null, headline: ['Total sales', 'Visits', 'Conversion rate', 'Commission paid'] },
  { key: 'store', label: 'Store Performance Tracker', href: go('https://walktrack.hemparshwa.com/dashboard'), gate: null, headline: ['Walk-ins', 'People', 'Converted', 'Avg visit duration'] },
  { key: 'cash', label: 'Cash Management & Payment Approvals', href: 'https://os.hemparshwa.com/cash', gate: null, headline: ['Total bank balance', 'Cash in hand', 'Pending approvals', 'Overdue'] },
  { key: 'marketing', label: 'Marketing Intelligence', href: '/marketing', gate: 'marketing', headline: ['Total leads', 'Converted leads', 'Sales generated', 'Total marketing spend'] },
] as const;

export type OverviewModule = (typeof OVERVIEW_MODULES)[number];
export type OverviewKey = OverviewModule['key'];
export type OverviewKpi = { label: string; value: string; caption?: string };

/** Set by the proxy on /flow only: the modules this visitor has signed in to. */
export const OVERVIEW_ACCESS_HEADER = 'x-overview-access';
