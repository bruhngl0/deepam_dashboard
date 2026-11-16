/** Monthly payout cycle: per partner, the validated commission to pay and what was paid, with the payment reference. */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { MONTH, monthLabel } from '@/lib/partners/constants';
import { payouts } from '@/lib/partners/queries';
import { refreshReferrals } from '@/lib/partners/store';
import { todayIst } from '@/lib/queries/daily';
import { formatCurrency, formatDate, formatNumber, formatPhone } from '@/lib/format';
import { button, card, control, eyebrow, FilterField, FilterRow, Kpi, KpiGrid, PageHeader, primaryButton } from '@/components/ui';
import { markPaidAction } from '../actions';
import { Notices, one, td, th } from '../ui';

export const dynamic = 'force-dynamic';

const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  const month = MONTH.test(one(sp.month)) ? one(sp.month) : todayIst().slice(0, 7);
  const lines = await payouts(month);
  const toPay = lines.reduce((s, l) => s + l.validated, 0), paid = lines.reduce((s, l) => s + l.paid, 0);
  const back = `/partners/payouts?month=${month}`;

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow="Partner Network" title={`Payouts · ${monthLabel(month)}`} description="Commission validated into this month's cycle. Pay each partner, then record the payment reference."
        actions={<><Link href={`/partners/payouts?month=${shift(month, -1)}`} className={button}>← {monthLabel(shift(month, -1))}</Link><Link href={`/partners/payouts?month=${shift(month, 1)}`} className={button}>{monthLabel(shift(month, 1))} →</Link><a href={`/partners/payouts/export?month=${month}`} className={button}>Download CSV</a></>} />
      <Notices sp={sp} />

      <form method="get"><FilterRow><FilterField label="Month"><input type="month" name="month" defaultValue={month} className={control} /></FilterField><button type="submit" className={button}>Show</button></FilterRow></form>

      <KpiGrid columns={3}>
        <Kpi label="To pay" value={formatCurrency(toPay)} caption={`${formatNumber(lines.filter((l) => l.validated > 0).length)} partners`} />
        <Kpi label="Paid" value={formatCurrency(paid)} caption={`${formatNumber(lines.filter((l) => l.paid > 0).length)} partners`} />
        <Kpi label="Bills in this cycle" value={formatNumber(lines.reduce((s, l) => s + l.bills, 0))} caption={`${formatCurrency(lines.reduce((s, l) => s + l.billValue, 0))} in bills`} />
      </KpiGrid>

      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
            <thead><tr className={eyebrow}>{['Partner', 'Documents', 'Bills', 'Bill value', 'To pay', 'Paid', 'Payment'].map((h, i) =>
              <th key={h} scope="col" className={`${th} ${i >= 2 && i <= 5 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={7} className={`${td} py-6 text-center text-ink-muted`}>Nothing validated into {monthLabel(month)}. Validate bills on <Link href="/partners/referrals" className="text-accent hover:underline">Referrals</Link>.</td></tr>}
              {lines.map((l) => (
                <tr key={l.partnerId} className="border-t border-grid hover:bg-inset/50">
                  <th scope="row" className={`${td} text-left font-medium text-ink`}><Link href={`/partners/${l.partnerCode ?? l.partnerId}`} className="hover:text-accent hover:underline">{l.partnerName}</Link><span className="tnum block text-xs font-normal text-ink-muted">{l.partnerCode} · {formatPhone(l.phone)}</span></th>
                  <td className={td}>{l.documentsComplete ? <span className="text-xs text-emerald-700 dark:text-emerald-300">Complete</span> : <Link href={`/partners/${l.partnerCode ?? l.partnerId}`} className="text-xs text-amber-700 hover:underline dark:text-amber-300">Pending: collect before paying</Link>}</td>
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
      </section>
    </main>
  );
}
