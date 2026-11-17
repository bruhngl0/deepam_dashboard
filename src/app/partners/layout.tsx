/**
 * Partner Network Management module shell: Overview, Partners, Referrals, Payouts and Rules (tabs in nav-tabs.tsx).
 * The public side (application, referral links, partner dashboards) is /deepampartner.
 * Each page calls `refreshReferrals()` itself: a layout is not re-rendered when moving between its pages.
 *
 * One filter strip above the list pages (components/module-filters.tsx), in the same order as HR Intelligence:
 * Store, then From/To (Month on Payouts), then Status / Category, then search.
 */

import { requireUser } from '@/lib/auth';
import { getFilterOptions } from '@/lib/queries/customers';
import { todayIst } from '@/lib/queries/daily';
import { PARTNER_CATEGORIES, PARTNER_STATUS_LABEL, PARTNER_STATUSES, REFERRAL_STATUS_LABEL, REFERRAL_STATUSES } from '@/lib/partners/constants';
import { ModuleFilters, type FilterPage } from '@/components/module-filters';

export default async function PartnersLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const options = await getFilterOptions();

  const pages: FilterPage[] = [
    { path: '/partners', store: true, period: 'range', note: 'Referrals by registration date and store; bills by bill date and store. Partner counts are as they stand today. Default: all dates.' },
    { path: '/partners/list', store: true, period: 'range', periodLabel: 'Applied', fields: [
      { kind: 'select', param: 'status', label: 'Status', all: 'All', options: PARTNER_STATUSES.map((s) => ({ value: s, label: PARTNER_STATUS_LABEL[s] })) },
      { kind: 'select', param: 'category', label: 'Category', all: 'All', options: PARTNER_CATEGORIES.map((c) => ({ value: c, label: c })) },
      { kind: 'search', param: 'q', placeholder: 'Name, Partner ID, phone, email, city' }],
      note: 'Store: partners with a referral who chose that store or billed there.' },
    { path: '/partners/referrals', store: true, period: 'range', periodLabel: 'Registered', fields: [
      { kind: 'select', param: 'status', label: 'Status', all: 'All', options: REFERRAL_STATUSES.map((s) => ({ value: s, label: REFERRAL_STATUS_LABEL[s] })) },
      { kind: 'search', param: 'q', placeholder: 'Customer, phone, CUS- or DPR- ID, partner' }],
      note: 'Bills to validate are narrowed by bill date and store; referrals by registration date and preferred store (or a bill there).' },
    { path: '/partners/payouts', period: 'month', note: 'A payout covers every store: each partner is paid once per month.' },
  ];

  return (
    <>
      <ModuleFilters pages={pages} stores={options.stores} thisMonth={todayIst().slice(0, 7)} />
      {children}
    </>
  );
}
