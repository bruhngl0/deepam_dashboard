/**
 * Partner Network Management module shell: Overview, Partners, Referrals, Payouts and Rules (tabs in nav-tabs.tsx).
 * The public side (application, referral links, partner dashboards) is /deepampartner.
 * Each page calls `refreshReferrals()` itself: a layout is not re-rendered when moving between its pages.
 */

import { requireUser } from '@/lib/auth';

export default async function PartnersLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
