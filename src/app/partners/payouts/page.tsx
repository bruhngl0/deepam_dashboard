/** Monthly payout cycle: per partner, the validated commission to pay and what was paid, with the payment reference. */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { monthLabel } from '@/lib/partners/constants';
import { pickMonth } from '@/lib/module-filters';
import { payouts } from '@/lib/partners/queries';
import { refreshReferrals } from '@/lib/partners/store';
import { formatCurrency, formatDate, formatNumber, formatPhone } from '@/lib/format';
import { button, control, primaryButton } from '@/components/ui';
import { markPaidAction } from '../actions';
import { Empty, Icon, Notices, Panel, PartnerHeader, Stat, td, th, tr, Who } from '../ui';

export const dynamic = 'force-dynamic';

const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  const month = pickMonth(sp);
  const lines = await payouts(month);
  const toPay = lines.reduce((s, l) => s + l.validated, 0), paid = lines.reduce((s, l) => s + l.paid, 0);
  const back = `/partners/payouts?month=${month}`;

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="wallet" eyebrow="Ananta Partner Network" title={`Payouts · ${monthLabel(month)}`} description="Commission validated into this month's cycle. Pay each partner, then record the payment reference."
        actions={<><span className="inline-flex overflow-hidden rounded-xl border border-line bg-surface shadow-sm"><Link href={`/partners/payouts?month=${shift(month, -1)}`} className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-ink hover:bg-inset"><Icon name="left" />{monthLabel(shift(month, -1))}</Link><Link href={`/partners/payouts?month=${shift(month, 1)}`} className="inline-flex items-center gap-1 border-l border-line px-3 py-2 text-sm font-medium text-ink hover:bg-inset">{monthLabel(shift(month, 1))}<Icon name="right" /></Link></span><a href={`/partners/payouts/export?month=${month}`} className={button}><Icon name="download" />Download CSV</a></>} />
      <Notices sp={sp} />


      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon="wallet" tone="wait" label="To pay" value={formatCurrency(toPay)} highlight={toPay > 0} caption={`${formatNumber(lines.filter((l) => l.validated > 0).length)} partners`} />
        <Stat icon="check" tone="good" label="Paid" value={formatCurrency(paid)} caption={`${formatNumber(lines.filter((l) => l.paid > 0).length)} partners`} />
        <Stat icon="receipt" tone="info" label="Bills in this cycle" value={formatNumber(lines.reduce((s, l) => s + l.bills, 0))} caption={`${formatCurrency(lines.reduce((s, l) => s + l.billValue, 0))} in bills`} />
      </div>

      <Panel title="Partners in this cycle" icon="users" count={lines.length} flush>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
            <thead><tr>{['Partner', 'Documents', 'Bills', 'Bill value', 'To pay', 'Paid', 'Payment'].map((h, i) =>
              <th key={h} scope="col" className={`${th} ${i >= 2 && i <= 5 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={7}><Empty icon="wallet">Nothing validated into {monthLabel(month)}. Validate bills on <Link href="/partners/referrals" className="text-accent hover:underline">Referrals</Link>.</Empty></td></tr>}
              {lines.map((l) => (
                <tr key={l.partnerId} className={tr}>
                  <th scope="row" className={`${td} text-left font-normal`}><Who name={l.partnerName} sub={`${l.partnerCode ?? ''} · ${formatPhone(l.phone)}`} href={`/partners/${l.partnerCode ?? l.partnerId}`} /></th>
                  <td className={td}>{l.documentsComplete ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300"><Icon name="check" className="size-3.5" />Complete</span> : <Link href={`/partners/${l.partnerCode ?? l.partnerId}`} className="inline-flex items-center gap-1 text-xs text-amber-700 hover:underline dark:text-amber-300"><Icon name="alert" className="size-3.5" />Pending: collect before paying</Link>}</td>
                  <td className={`tnum ${td} text-right`}>{formatNumber(l.bills)}</td>
                  <td className={`tnum ${td} text-right text-ink-2`}>{formatCurrency(l.billValue)}</td>
                  <td className={`tnum ${td} text-right font-medium text-ink`}>{l.validated ? formatCurrency(l.validated) : '—'}</td>
                  <td className={`tnum ${td} text-right`}>{l.paid ? <>{formatCurrency(l.paid)}<span className="block text-xs text-ink-muted">{l.paidAt ? formatDate(l.paidAt) : ''}{l.references.length ? ` · ${l.references.join(', ')}` : ''}</span></> : '—'}</td>
                  <td className={td}>
                    {l.validated > 0 && (
                      <form action={markPaidAction} className="flex gap-1">
                        <input type="hidden" name="id" value={l.partnerId} /><input type="hidden" name="month" value={month} /><input type="hidden" name="back" value={back} />
                        <input name="reference" required maxLength={120} placeholder="UTR / cheque no." className={`${control} w-40 py-1`} aria-label={`Payment reference for ${l.partnerName}`} />
                        <button type="submit" className={primaryButton}>Mark paid</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}
