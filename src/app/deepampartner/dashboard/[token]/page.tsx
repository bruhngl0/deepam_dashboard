import type { Metadata } from 'next';
import { COMMISSION_STATUS_LABEL, DECLINE_SHORT, monthLabel, REFERRAL_STATUS_LABEL } from '@/lib/partners/constants';
import { partnerLinkBase } from '@/lib/partners/links';
import { dashboardFor } from '@/lib/partners/queries';
import { refreshReferrals } from '@/lib/partners/store';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { CopyLink } from '../../forms';
import { btn, frame, heading, kicker, page, tile } from '../../styles';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Partner dashboard · Deepam Partners', referrer: 'no-referrer' };

const cell = 'border-t border-[#efe7da] px-3 py-3 text-left align-top';
const STATUS_CHIP: Record<string, string> = {
  registered: 'border-[#e5d8c3] bg-[#faf6ef] text-[#5c5c5c]',
  converted: 'border-[#7f1835]/30 bg-[#7f1835]/5 text-[#7f1835]',
  expired: 'border-[#e5e5e5] bg-white text-[#8a8a8a]',
  declined: 'border-[#e5e5e5] bg-white text-[#8a8a8a]',
};

/**
 * A partner's own dashboard, opened from the private link staff send them. Shows their referral link, this month's
 * eligible sales, commission level and estimated earnings with progress to the next level, their partnership level,
 * their referrals (first name and initial only) and commission; no phone numbers or bill amounts.
 */
export default async function PartnerDashboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await refreshReferrals();
  const d = await dashboardFor(token);
  if (!d) {
    return (
      <main className={page}>
        <div className="mx-auto max-w-[720px] text-center">
          <h1 className={`${heading} mb-3`}>This dashboard link is not active</h1>
          <p>Please ask the Deepam team for your current dashboard link.</p>
        </div>
      </main>
    );
  }
  const link = `${await partnerLinkBase()}/${d.code}`;
  const share = `Planning a visit to Deepam? Book your appointment here: ${link}`;
  const tiles: [string, string][] = [
    ['Referrals', formatNumber(d.totals.referrals)],
    ['Purchased', formatNumber(d.totals.converted)],
    ['Commission validated', formatCurrency(d.totals.validated)],
    ['Commission paid', formatCurrency(d.totals.paid)],
  ];

  return (
    <main className={page}>
      <div className="mx-auto max-w-[960px] space-y-10">
        <header className="text-center">
          <p className={kicker}>Deepam Partner {d.code}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.08em] text-[#5c5c5c]">{d.category} · Partnership {d.levelName}{d.personalDiscount ? ` · ${d.personalDiscount}% personal shopping discount` : ''}</p>
          <h1 className={`${heading} mt-2`}>Welcome, <strong className="font-bold">{d.name.split(/\s+/)[0]}</strong></h1>
          {(d.status === 'suspended' || d.status === 'on_hold') && <p className="mt-3 text-[#a12b2b]">Your referral link is paused. Please contact the Deepam team.</p>}
          {d.status === 'terminated' && <p className="mt-3 text-[#a12b2b]">Your partnership has closed. Earnings already made are settled as agreed.</p>}
        </header>

        {d.status === 'approved' && (
          <section aria-labelledby="link-heading" className={`${frame} space-y-4`}>
            <h2 id="link-heading" className="text-[1.2em] font-semibold">Your referral link</h2>
            <CopyLink url={link} />
            <div><a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer" className={btn}>Share on WhatsApp</a></div>
            <p className="text-[#5c5c5c]">A purchase counts when the customer registers on your link and buys within {d.windowDays} days. For someone who already shops at Deepam, our team confirms your part first.</p>
          </section>
        )}

        <section aria-labelledby="month-heading" className={`${frame} space-y-3`}>
          <h2 id="month-heading" className="text-[1.2em] font-semibold">This month · {monthLabel(d.month.month)}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              ['Eligible sales', formatCurrency(d.month.eligibleSales)],
              ['Commission level', `${d.month.level.name} · ${d.month.level.commissionPercent}%`],
              ['Estimated commission', formatCurrency(d.month.commission)],
              ['Monthly bonus', formatCurrency(d.month.bonus)],
            ] as const).map(([k, v]) => (
              <div key={k} className={`${tile} px-4 py-4 text-center`}>
                <p className="text-xs uppercase tracking-[0.08em] text-[#5c5c5c]">{k}</p>
                <p className="mt-1 text-xl font-semibold text-[#7f1835]">{v}</p>
              </div>
            ))}
          </div>
          {d.month.next && (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-[#efe7da]"><div className="h-full bg-[#7f1835]" style={{ width: `${Math.min(100, (d.month.eligibleSales / d.month.next.level.minSales) * 100)}%` }} /></div>
              <p className="mt-2 text-[#5c5c5c]">{formatCurrency(d.month.next.needed)} more this month reaches {d.month.next.level.name}: {d.month.next.level.commissionPercent}% on the whole month and a {formatCurrency(d.month.next.level.bonus)} bonus.</p>
            </div>
          )}
          <p className="text-xs text-[#5c5c5c]">Estimated until the month ends and our team verifies it. Eligible sales are the value before GST, less returns.</p>
        </section>

        <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map(([k, v]) => (
            <div key={k} className={`${tile} px-4 py-5 text-center`}>
              <p className="text-xs uppercase tracking-[0.08em] text-[#5c5c5c]">{k}</p>
              <p className="mt-2 text-2xl font-semibold text-[#7f1835]">{v}</p>
            </div>
          ))}
        </section>
        {d.totals.pendingBills > 0 && <p className="text-center text-[#5c5c5c]">{formatNumber(d.totals.pendingBills)} {d.totals.pendingBills === 1 ? 'purchase is' : 'purchases are'} being checked by our team; the commission appears once validated.</p>}

        <section aria-labelledby="ref-heading" className={frame}>
          <h2 id="ref-heading" className="mb-3 text-[1.2em] font-semibold">Your referrals</h2>
          {d.referrals.length === 0 ? <p className="text-[#5c5c5c]">No one has registered on your link yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" style={{ minWidth: '40rem' }}>
                <thead><tr className="text-xs uppercase tracking-[0.06em] text-[#5c5c5c]">
                  {['Customer', 'Registered', 'Occasion', 'Status', 'Commission'].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-semibold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.referrals.map((r) => (
                    <tr key={r.id}>
                      <td className={cell}>{r.name}</td>
                      <td className={cell}>{formatDate(r.registeredAt)}</td>
                      <td className={cell}>{r.occasion}</td>
                      <td className={cell}>
                        <span className={`inline-block border px-2 py-0.5 text-xs ${STATUS_CHIP[r.status] ?? STATUS_CHIP.expired}`}>{REFERRAL_STATUS_LABEL[r.status]}</span>
                        {r.status === 'registered' && <span className="block text-xs text-[#5c5c5c]">Counts until {formatDate(r.windowEndsOn)}</span>}
                        {r.declineReason && <span className="block text-xs text-[#5c5c5c]">{DECLINE_SHORT[r.declineReason]}</span>}
                        {r.toVerify && <span className="block text-xs text-[#5c5c5c]">Existing customer: our team is confirming your part</span>}
                      </td>
                      <td className={cell}>
                        {r.commission.length === 0 ? '—' : r.commission.map((c, i) => (
                          <span key={i} className="block">
                            {c.amount !== null ? formatCurrency(c.amount) : ''} {c.status === 'pending' ? 'Being checked' : COMMISSION_STATUS_LABEL[c.status]}
                            {c.payoutMonth && c.status !== 'rejected' && <span className="text-xs text-[#5c5c5c]"> · {monthLabel(c.payoutMonth)} payout</span>}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
