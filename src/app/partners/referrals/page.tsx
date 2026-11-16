/**
 * Referrals: the bills matched to referred customers waiting for validation (validated bills enter a month's payout
 * cycle), then every registration on a partner link with its status and bills.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { monthLabel, REFERRAL_STATUS_LABEL, REFERRAL_STATUSES } from '@/lib/partners/constants';
import { getRules, listReferrals, pendingCommissions } from '@/lib/partners/queries';
import { refreshReferrals } from '@/lib/partners/store';
import { todayIst } from '@/lib/queries/daily';
import { formatCurrency, formatDate, formatNumber, formatPhone } from '@/lib/format';
import { button, card, control, eyebrow, FilterField, FilterRow, PageHeader, primaryButton, SectionLabel, textButton } from '@/components/ui';
import { validateAction } from '../actions';
import { ReferralTable } from '../referral-table';
import { Notices, one, td, th } from '../ui';

export const dynamic = 'force-dynamic';

/** This month and the two before it: a bill is normally validated into the current cycle, late ones into the last. */
function payoutMonths(today: string) {
  const [y, m] = today.split('-').map(Number);
  return [0, 1, 2].map((back) => {
    const d = new Date(Date.UTC(y, m - 1 - back, 1));
    return d.toISOString().slice(0, 7);
  });
}

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  const status = REFERRAL_STATUSES.find((s) => s === one(sp.status)) ?? '';
  const search = one(sp.q).slice(0, 80);
  const today = todayIst();
  const [pending, referrals, rules] = await Promise.all([pendingCommissions(), listReferrals({ status, search }), getRules()]);
  const query = new URLSearchParams(Object.entries({ status, q: search }).filter(([, v]) => v)).toString();
  const back = `/partners/referrals${query ? `?${query}` : ''}`;
  const filtered = !!(status || search);

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow="Partner Network" title="Referrals"
        description={`Customers registered on a partner link. A bill on their number (or Customer ID) within ${rules.windowDays} days of registering is matched here; validate it to put the commission in a month's payout.`} />
      <Notices sp={sp} />

      <SectionLabel>Bills to validate</SectionLabel>
      {pending.length === 0 ? (
        <p className={`${card} px-5 py-4 text-sm text-ink-muted`}>No bills waiting. New bills are matched as sales are synced from Hemparshwa.</p>
      ) : (
        <form action={validateAction} className="space-y-3">
          <input type="hidden" name="back" value={back} />
          <section className={`${card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
                <thead><tr className={eyebrow}>
                  <th scope="col" className={`${th} w-10`}><span className="sr-only">Validate</span></th>
                  {['Bill', 'Customer', 'Partner', 'Registered', 'Bill amount', 'Commission'].map((h, i) => <th key={h} scope="col" className={`${th} ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {pending.map((c) => (
                    <tr key={c.id} className="border-t border-grid hover:bg-inset/50">
                      <td className={td}><input type="checkbox" name="commission" value={c.id} defaultChecked={c.percent !== null} disabled={c.percent === null} className="size-4" aria-label={`Validate ${c.voucherNo}`} /></td>
                      <td className={td}><span className="tnum text-ink">{c.voucherNo}</span><span className="tnum block text-xs text-ink-muted">{formatDate(c.billedAt)}{c.storeName ? ` · ${c.storeName}` : ''}</span></td>
                      <td className={td}>{c.customerCode ? <Link href={`/crm/buyers/${c.customerCode}`} className="text-ink hover:text-accent hover:underline">{c.customerName}</Link> : c.customerName}<span className="tnum block text-xs text-ink-muted">{formatPhone(c.phone)}{c.customerCode ? ` · ${c.customerCode}` : ''}</span></td>
                      <td className={td}><Link href={`/partners/${c.partnerCode ?? c.partnerId}`} className="text-ink hover:text-accent hover:underline">{c.partnerName}</Link><span className="tnum block text-xs text-ink-muted">{c.partnerCode} · Level {c.level}</span></td>
                      <td className={`tnum ${td} text-ink-2`}>{formatDate(c.registeredAt)}</td>
                      <td className={`tnum ${td} text-right text-ink`}>{formatCurrency(c.billAmount)}</td>
                      <td className={`tnum ${td} text-right`}>{c.estimate !== null ? <>{formatCurrency(c.estimate)}<span className="block text-xs text-ink-muted">{c.percent}%</span></> : <Link href="/partners/rules" className="text-xs text-amber-700 hover:underline dark:text-amber-300">Set Level {c.level} %</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="flex flex-wrap items-center gap-2">
            <FilterField label="Payout month">
              <select name="month" defaultValue={today.slice(0, 7)} className={control}>{payoutMonths(today).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
            </FilterField>
            <button type="submit" className={primaryButton}>Validate ticked bills</button>
            <p className="text-xs text-ink-muted">Check each bill against the POS first (not returned, the referred person). To refuse one, use Reject next to it below.</p>
          </div>
        </form>
      )}

      <SectionLabel>All referrals</SectionLabel>
      <form method="get">
        <FilterRow note={`${formatNumber(referrals.length)} shown${referrals.length >= 500 ? ' (the latest 500; narrow the search)' : ''}`}>
          <FilterField label="Status">
            <select name="status" defaultValue={status} className={control}>
              <option value="">All</option>
              {REFERRAL_STATUSES.map((s) => <option key={s} value={s}>{REFERRAL_STATUS_LABEL[s]}</option>)}
            </select>
          </FilterField>
          <input type="search" name="q" defaultValue={search} placeholder="Customer, phone, CUS- or DPR- ID, partner" className={`${control} w-72`} aria-label="Search referrals" />
          <button type="submit" className={button}>Apply</button>
          {filtered && <Link href="/partners/referrals" className={textButton}>Clear filters</Link>}
        </FilterRow>
      </form>
      <ReferralTable referrals={referrals} back={back} empty={filtered ? 'No referral matches these filters.' : 'No one has registered on a partner link yet.'} />
    </main>
  );
}
