/** Small pieces shared by the Partner Network pages. */

import { COMMISSION_STATUS_LABEL, PARTNER_STATUS_LABEL, REFERRAL_STATUS_LABEL, type CommissionStatus, type PartnerStatus, type ReferralStatus } from '@/lib/partners/constants';

const GOOD = 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300';
const WAIT = 'border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
const INFO = 'border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
const BAD = 'border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300';
const QUIET = 'border-line bg-inset text-ink-2';

const TONE: Record<string, string> = {
  applied: WAIT, approved: GOOD, rejected: QUIET, suspended: BAD,
  registered: INFO, converted: GOOD, expired: QUIET, declined: QUIET,
  pending: WAIT, validated: INFO, paid: GOOD,
};

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{children}</span>;
}

export const PartnerBadge = ({ status }: { status: PartnerStatus }) => <Badge tone={TONE[status]}>{PARTNER_STATUS_LABEL[status]}</Badge>;
export const ReferralBadge = ({ status }: { status: ReferralStatus }) => <Badge tone={TONE[status]}>{REFERRAL_STATUS_LABEL[status]}</Badge>;
export const CommissionBadge = ({ status }: { status: CommissionStatus }) => <Badge tone={status === 'rejected' ? BAD : TONE[status]}>{COMMISSION_STATUS_LABEL[status]}</Badge>;

/** The ?notice= / ?error= a partner action returns with. */
export function Notices({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const error = typeof sp.error === 'string' ? sp.error : null;
  const notice = typeof sp.notice === 'string' ? sp.notice : null;
  return <>
    {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-600/30 bg-emerald-600/10 px-4 py-2 text-sm text-emerald-800 dark:text-emerald-300">{notice}</p>}
  </>;
}

export const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
export const th = 'px-4 py-3 font-bold';
export const td = 'px-4 py-2 align-top';
