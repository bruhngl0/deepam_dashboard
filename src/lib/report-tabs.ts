/** The CRM reports, tabs in the site header on /reports pages (nav-tabs.tsx). */
export const REPORTS = [
  { href: '/reports/funnel', label: 'Funnel' },
  { href: '/reports/salespeople', label: 'Salespeople' },
  { href: '/reports/payback', label: 'Payback' },
  { href: '/reports/cohorts', label: 'Cohorts' },
  { href: '/reports/stock', label: 'Stock' },
  { href: '/reports/salespeople/match', label: 'Salesperson matching' },
] as const;

/** The report a page is: the longest tab address it starts with (Salesperson matching beats Salespeople). */
export function currentReport(pathname: string): string | null {
  const hits = REPORTS.filter(r => pathname === r.href || pathname.startsWith(`${r.href}/`)).map(r => r.href);
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}
