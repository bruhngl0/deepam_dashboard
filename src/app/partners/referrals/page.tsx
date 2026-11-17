/**
 * Referrals: the bills matched to referred customers waiting for validation (validated bills enter a month's payout
 * cycle), then every registration on a partner link with its status and bills.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { monthLabel, REFERRAL_STATUSES } from '@/lib/partners/constants';
import { getRules, listReferrals, pendingCommissions } from '@/lib/partners/queries';
import { pickRange, pickStores, rangeLabel } from '@/lib/module-filters';
import { refreshReferrals } from '@/lib/partners/store';
import { todayIst } from '@/lib/queries/daily';
import { formatCurrency, formatDate, formatNumber, formatPhone } from '@/lib/format';
import { control, FilterField, primaryButton } from '@/components/ui';
import { validateAction } from '../actions';
import { ReferralTable } from '../referral-table';
import { Empty, Icon, IconTile, Notices, one, Panel, PartnerHeader, td, th, tr, Who } from '../ui';

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
  const { from, to } = pickRange(sp, { from: null, to: null });
  const stores = pickStores(sp);
  const scope = { from, to, stores };
  const [pending, referrals, rules] = await Promise.all([pendingCommissions(scope), listReferrals({ status, search, ...scope }), getRules()]);
  const query = new URLSearchParams(Object.entries({ store: stores ?? '', from: from ?? '', to: to ?? '', status, q: search }).filter(([, v]) => v)).toString();
  const back = `/partners/referrals${query ? `?${query}` : ''}`;
  const filtered = !!(status || search || from || to || stores);

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="link" eyebrow="Partner Network" title="Referrals"
        description={`Customers registered on a partner link. A bill on their number (or Customer ID) within ${rules.windowDays} days of registering is matched here; validate it to put the commission in a month's payout.`} />
      <Notices sp={sp} />

      {pending.length === 0 ? (
        <Panel title="Bills to validate" icon="receipt" tone="wait" count={0}><Empty icon="check">No bills waiting. New bills are matched as sales are synced from Hemparshwa.</Empty></Panel>
      ) : (
        <form action={validateAction}>
          <input type="hidden" name="back" value={back} />
          <Panel title="Bills to validate" icon="receipt" tone="wait" count={pending.length} flush description="Check each bill against the POS first (not returned, the referred person). To refuse one, use Reject next to it under All referrals.">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
                <thead><tr>
                  <th scope="col" className={`${th} w-10`}><span className="sr-only">Validate</span></th>
                  {['Bill', 'Customer', 'Partner', 'Registered', 'Bill amount', 'Commission'].map((h, i) => <th key={h} scope="col" className={`${th} ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {pending.map((c) => (
                    <tr key={c.id} className={tr}>
                      <td className={td}><input type="checkbox" name="commission" value={c.id} defaultChecked={c.percent !== null} disabled={c.percent === null} className="size-4 accent-accent" aria-label={`Validate ${c.voucherNo}`} /></td>
                      <td className={td}><span className="tnum text-ink">{c.voucherNo}</span><span className="tnum block text-xs text-ink-muted">{formatDate(c.billedAt)}{c.storeName ? ` · ${c.storeName}` : ''}</span></td>
                      <td className={td}>{c.customerCode ? <Link href={`/crm/buyers/${c.customerCode}`} className="text-ink hover:text-accent hover:underline">{c.customerName}</Link> : c.customerName}<span className="tnum block text-xs text-ink-muted">{formatPhone(c.phone)}{c.customerCode ? ` · ${c.customerCode}` : ''}</span></td>
                      <td className={td}><Who name={c.partnerName} sub={`${c.partnerCode ?? ''} · Level ${c.level}`} href={`/partners/${c.partnerCode ?? c.partnerId}`} /></td>
                      <td className={`tnum ${td} text-ink-2`}>{formatDate(c.registeredAt)}</td>
                      <td className={`tnum ${td} text-right text-ink`}>{formatCurrency(c.billAmount)}</td>
                      <td className={`tnum ${td} text-right font-semibold text-ink`}>{c.estimate !== null ? <>{formatCurrency(c.estimate)}<span className="block text-xs text-ink-muted">{c.percent}%</span></> : <Link href="/partners/rules" className="text-xs text-amber-700 hover:underline dark:text-amber-300">Set Level {c.level} %</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-grid bg-inset/40 px-5 py-4">
            <FilterField label="Payout month">
              <select name="month" defaultValue={today.slice(0, 7)} className={control}>{payoutMonths(today).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
            </FilterField>
            <button type="submit" className={primaryButton}><Icon name="check" />Validate ticked bills</button>
          </div>
          </Panel>
        </form>
      )}

      <h2 className="flex items-center gap-2.5 pt-2 text-base font-semibold tracking-tight text-ink"><IconTile name="users" tone="info" size="sm" />All referrals</h2>
      <p className="text-xs text-ink-muted">{formatNumber(referrals.length)} shown{from || to ? ` · registered ${rangeLabel(from, to)}` : ''}{referrals.length >= 500 ? ' (the latest 500; narrow the filters)' : ''}</p>
      <ReferralTable referrals={referrals} back={back} empty={filtered ? 'No referral matches these filters.' : 'No one has registered on a partner link yet.'} />
    </main>
  );
}
