/** Referrals with the bills matched to them; shared by the Referrals page and a partner's page. */

import Link from 'next/link';
import { DECLINE_LABEL, monthLabel } from '@/lib/partners/constants';
import type { Referral } from '@/lib/partners/queries';
import { formatCurrency, formatDate, formatPhone } from '@/lib/format';
import { card, control } from '@/components/ui';
import { rejectCommissionAction, reopenCommissionAction } from './actions';
import { CommissionBadge, Empty, Icon, ReferralBadge, td, th, tr, Who } from './ui';

export function ReferralTable({ referrals, back, showPartner = true, empty }: { referrals: Referral[]; back: string; showPartner?: boolean; empty: string }) {
  const heads = ['Customer', ...(showPartner ? ['Partner'] : []), 'Visit', 'Registered', 'Status', 'Bills and commission'];
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: '72rem' }}>
          <thead><tr>{heads.map((h) => <th key={h} scope="col" className={`${th} text-left`}>{h}</th>)}</tr></thead>
          <tbody>
            {referrals.length === 0 && <tr><td colSpan={heads.length}><Empty icon="link">{empty}</Empty></td></tr>}
            {referrals.map((r) => (
              <tr key={r.id} className={tr}>
                <th scope="row" className={`${td} text-left font-normal`}>
                  <Who name={r.fullName} sub={`${formatPhone(r.phone)}${r.customerCode ? ` · ${r.customerCode}` : ''}`} href={r.customerCode ? `/crm/buyers/${r.customerCode}` : undefined} />
                </th>
                {showPartner && <td className={td}><Link href={`/partners/${r.partnerCode ?? r.partnerId}`} className="text-ink hover:text-accent hover:underline">{r.partnerName}</Link><span className="tnum block text-xs text-ink-muted">{r.partnerCode}</span></td>}
                <td className={`${td} text-ink-2`}>{r.occasion}<span className="block text-xs text-ink-muted">{[r.storeName, r.appointmentDate && formatDate(r.appointmentDate)].filter(Boolean).join(' · ')}</span></td>
                <td className={`tnum ${td} text-ink-2`}>{formatDate(r.registeredAt)}{r.status !== 'declined' && <span className="block text-xs text-ink-muted">Window to {formatDate(r.windowEndsOn)}</span>}</td>
                <td className={td}><ReferralBadge status={r.status} />{r.declineReason && <span className="mt-1 block max-w-[16rem] text-xs text-ink-muted">{DECLINE_LABEL[r.declineReason]}{r.verifyNote ? `: “${r.verifyNote}”` : ''}</span>}
                  {r.verifyStatus === 'pending' && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">Existing customer: to verify</span>}
                  {r.verifyStatus === 'verified' && <span className="mt-1 block max-w-[16rem] text-xs text-ink-muted">Existing customer, verified{r.verifiedBy ? ` by ${r.verifiedBy}` : ''}</span>}</td>
                <td className={td}>
                  {r.commissions.length === 0 ? <span className="text-ink-muted">—</span> : (
                    <ul className="space-y-2">
                      {r.commissions.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-inset/50 px-3 py-2">
                          <span className="tnum inline-flex items-center gap-1 font-medium text-ink"><Icon name="receipt" className="size-3.5 text-ink-muted" />{c.voucherNo}</span>
                          <span className="tnum text-ink-2">{formatDate(c.billedAt)} · {formatCurrency(c.billAmount)}{c.net !== c.billAmount ? ` (${formatCurrency(c.net)} before GST, less returns)` : ''}{c.storeName ? ` · ${c.storeName}` : ''}</span>
                          <CommissionBadge status={c.status} />
                          {c.amount !== null && <span className="tnum font-semibold text-ink">{formatCurrency(c.amount)} <span className="text-xs text-ink-muted">({c.percent}%{c.payoutMonth ? `, ${monthLabel(c.payoutMonth)}` : ''})</span></span>}
                          {c.estimate !== null && <span className="tnum text-xs text-ink-muted">≈ {formatCurrency(c.estimate)} at the month&rsquo;s rate so far</span>}
                          {c.reference && <span className="text-xs text-ink-muted">Ref {c.reference}</span>}
                          {c.note && <span className="text-xs text-ink-muted">“{c.note}”</span>}
                          {(c.status === 'pending' || c.status === 'validated') && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-ink-muted hover:text-red-600">Reject</summary>
                              <form action={rejectCommissionAction} className="mt-1 flex gap-1">
                                <input type="hidden" name="commission" value={c.id} /><input type="hidden" name="back" value={back} />
                                <input name="note" required maxLength={300} placeholder="Reason, e.g. returned" className={`${control} py-1 text-xs`} aria-label={`Reason to reject ${c.voucherNo}`} />
                                <button type="submit" className="rounded-lg border border-red-500/40 px-2 text-red-700 hover:bg-red-500/10 dark:text-red-300">Reject</button>
                              </form>
                            </details>
                          )}
                          {(c.status === 'validated' || c.status === 'rejected') && (
                            <form action={reopenCommissionAction}>
                              <input type="hidden" name="commission" value={c.id} /><input type="hidden" name="back" value={back} />
                              <button type="submit" className="text-xs text-ink-muted hover:text-ink hover:underline">Undo</button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
