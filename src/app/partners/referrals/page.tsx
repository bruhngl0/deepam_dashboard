/**
 * Referrals: existing customers' referrals waiting for verification, the bills matched to referred customers waiting
 * for validation (a validated bill earns its month's whole-month rate on its net value), then every registration on a
 * partner link with its status and bills.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { monthLabel, REFERRAL_STATUSES } from '@/lib/partners/constants';
import { listReferrals, pendingCommissions, referralDays } from '@/lib/partners/queries';
import { pickRange, pickStores, rangeLabel } from '@/lib/module-filters';
import { refreshReferrals } from '@/lib/partners/store';
import { formatCurrency, formatDate, formatNumber, formatPhone } from '@/lib/format';
import { button, control, primaryButton } from '@/components/ui';
import { validateAction, verifyReferralAction } from '../actions';
import { ReferralTable } from '../referral-table';
import { Empty, Icon, IconTile, Notices, one, Panel, PartnerHeader, td, th, tr, Who } from '../ui';

export const dynamic = 'force-dynamic';

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  const status = REFERRAL_STATUSES.find((s) => s === one(sp.status)) ?? '';
  const search = one(sp.q).slice(0, 80);
  const { from, to } = pickRange(sp, { from: null, to: null });
  const stores = pickStores(sp);
  const scope = { from, to, stores };
  const [pending, referrals, windowDays, toVerify] = await Promise.all([pendingCommissions(scope), listReferrals({ status, search, ...scope }), referralDays(), listReferrals({ toVerify: true })]);
  const query = new URLSearchParams(Object.entries({ store: stores ?? '', from: from ?? '', to: to ?? '', status, q: search }).filter(([, v]) => v)).toString();
  const back = `/partners/referrals${query ? `?${query}` : ''}`;
  const filtered = !!(status || search || from || to || stores);

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="link" eyebrow="Ananta Partner Network" title="Referrals"
        description={`Customers registered on a partner link. A bill on their number (or Customer ID) within ${windowDays} days of registering is matched here. Validate it once checked against the POS: it earns its month's commission level rate on its value before GST, less returns.`} />
      <Notices sp={sp} />

      {toVerify.length > 0 && (
        <Panel title="Existing customers to verify" icon="user" tone="wait" count={toVerify.length} flush
          description="These numbers already bought from Deepam. Check the partner really brought the customer in for this purchase (ask the store, the customer or the partner) before their bills can earn.">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
              <thead><tr>{['Customer', 'Partner', 'Registered', 'Bills', 'Decision'].map((h) => <th key={h} scope="col" className={`${th} text-left`}>{h}</th>)}</tr></thead>
              <tbody>
                {toVerify.map((r) => (
                  <tr key={r.id} className={tr}>
                    <td className={td}><Who name={r.fullName} sub={`${formatPhone(r.phone)}${r.customerCode ? ` · ${r.customerCode}` : ''}`} href={r.customerCode ? `/crm/buyers/${r.customerCode}` : undefined} /></td>
                    <td className={td}><Who name={r.partnerName} sub={r.partnerCode ?? ''} href={`/partners/${r.partnerCode ?? r.partnerId}`} /></td>
                    <td className={`tnum ${td} text-ink-2`}>{formatDate(r.registeredAt)}<span className="block text-xs text-ink-muted">valid to {formatDate(r.windowEndsOn)}</span></td>
                    <td className={`tnum ${td} text-ink-2`}>{r.commissions.length ? r.commissions.map((c) => `${c.voucherNo} · ${formatCurrency(c.billAmount)}`).join(', ') : 'No bill yet'}</td>
                    <td className={td}>
                      <form action={verifyReferralAction} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="referral" value={r.id} /><input type="hidden" name="back" value={back} />
                        <input name="note" maxLength={300} placeholder="How it was checked / why not" className={`${control} w-56 py-1 text-xs`} aria-label={`Note for ${r.fullName}`} />
                        <input name="by" required maxLength={80} placeholder="Your name" className={`${control} w-32 py-1 text-xs`} aria-label="Your name" />
                        <button type="submit" name="decision" value="verify" className={`${primaryButton} py-1 text-xs`}>Verify</button>
                        <button type="submit" name="decision" value="decline" className={`${button} py-1 text-xs`}>Not accepted</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {pending.length === 0 ? (
        <Panel title="Bills to validate" icon="receipt" tone="wait" count={0}><Empty icon="check">No bills waiting. New bills are matched as sales are synced from Hemparshwa.</Empty></Panel>
      ) : (
        <form action={validateAction}>
          <input type="hidden" name="back" value={back} />
          <Panel title="Bills to validate" icon="receipt" tone="wait" count={pending.length} flush description="Check each bill against the POS first (completed, paid, the referred person). To refuse one, use Reject next to it under All referrals. The commission shown is an estimate until the month ends: the rate moves with the month's total.">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
                <thead><tr>
                  <th scope="col" className={`${th} w-10`}><span className="sr-only">Validate</span></th>
                  {['Bill', 'Customer', 'Partner', 'Registered', 'Bill amount', 'Before GST, less returns', 'Commission (estimate)'].map((h, i) => <th key={h} scope="col" className={`${th} ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {pending.map((c) => (
                    <tr key={c.id} className={tr}>
                      <td className={td}><input type="checkbox" name="commission" value={c.id} defaultChecked={!c.unverified} disabled={c.unverified} className="size-4 accent-accent" aria-label={`Validate ${c.voucherNo}`} /></td>
                      <td className={td}><span className="tnum text-ink">{c.voucherNo}</span><span className="tnum block text-xs text-ink-muted">{formatDate(c.billedAt)}{c.storeName ? ` · ${c.storeName}` : ''}</span></td>
                      <td className={td}>{c.customerCode ? <Link href={`/crm/buyers/${c.customerCode}`} className="text-ink hover:text-accent hover:underline">{c.customerName}</Link> : c.customerName}<span className="tnum block text-xs text-ink-muted">{formatPhone(c.phone)}{c.customerCode ? ` · ${c.customerCode}` : ''}</span></td>
                      <td className={td}><Who name={c.partnerName} sub={`${c.partnerCode ?? ''}${c.commissionLevel ? ` · ${monthLabel(c.month)}: Level ${c.commissionLevel}` : ''}`} href={`/partners/${c.partnerCode ?? c.partnerId}`} /></td>
                      <td className={`tnum ${td} text-ink-2`}>{formatDate(c.registeredAt)}</td>
                      <td className={`tnum ${td} text-right text-ink`}>{formatCurrency(c.billAmount)}</td>
                      <td className={`tnum ${td} text-right text-ink-2`}>{formatCurrency(c.net)}</td>
                      <td className={`tnum ${td} text-right font-semibold text-ink`}>{c.unverified ? <span className="text-xs font-normal text-amber-700 dark:text-amber-300">Verify the referral first</span> : c.estimate !== null ? <>{formatCurrency(c.estimate)}<span className="block text-xs text-ink-muted">{c.percent}%</span></> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-grid bg-inset/40 px-5 py-4">
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
