/**
 * Partner Network overview: applications waiting, partners, referrals and how many bought, commission to validate,
 * to pay and paid this month, then results by category and the top partners.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { monthLabel } from '@/lib/partners/constants';
import { partnerLinkBase } from '@/lib/partners/links';
import { getRules, overview } from '@/lib/partners/queries';
import { refreshReferrals } from '@/lib/partners/store';
import { todayIst } from '@/lib/queries/daily';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '@/lib/format';
import { button, card, eyebrow, Kpi, KpiGrid, PageHeader, SectionLabel } from '@/components/ui';
import { WhatsAppShare } from '@/components/whatsapp-share';
import { td, th } from './ui';

export const dynamic = 'force-dynamic';

export default async function PartnersOverviewPage() {
  await requireUser();
  await refreshReferrals();
  const month = todayIst().slice(0, 7);
  const [o, rules, base] = await Promise.all([overview(month), getRules(), partnerLinkBase()]);
  const ratesMissing = rules.levels.filter((l) => l.percent === null).length;
  const applyLink = base;

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Partner Network Management" description="Deepam Partners: applications, referral links, referred customers and monthly commission payouts."
        actions={<><Link href="/partners/list?status=applied" className={button}>Review applications</Link><Link href="/partners/referrals" className={button}>Validate bills</Link></>} />

      {ratesMissing > 0 && (
        <p className="rounded-xl border border-amber-600/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
          Commission % is not set for {ratesMissing} of the 5 levels. Bills are still matched, but cannot be validated for payout until the partner&rsquo;s level has a rate. <Link href="/partners/rules" className="font-medium underline">Set the rules</Link>
        </p>
      )}

      <KpiGrid>
        <Kpi label="Applications to review" value={formatNumber(o.applied)} href="/partners/list?status=applied" caption={`${formatNumber(o.rejected)} rejected so far`} />
        <Kpi label="Active partners" value={formatNumber(o.approved)} href="/partners/list?status=approved" caption={o.suspended ? `${formatNumber(o.suspended)} suspended` : 'Approved, link accepting registrations'} />
        <Kpi label="Referred customers" value={formatNumber(o.referrals)} href="/partners/referrals"
          caption={`${formatNumber(o.open)} inside the ${rules.windowDays}-day window · ${formatNumber(o.declined)} not accepted`} />
        <Kpi label="Purchased" value={formatNumber(o.converted)} href="/partners/referrals?status=converted"
          caption={`${formatPercent(o.converted, o.converted + o.expired)} of closed windows · ${formatCurrencyCompact(o.salesValue)} in bills`} />
        <Kpi label="Bills to validate" value={formatNumber(o.toValidate)} href="/partners/referrals" caption={`${formatCurrencyCompact(o.toValidateValue)} in bills, matched to referrals`} />
        <Kpi label="Validated, not yet paid" value={formatCurrency(o.validatedUnpaid)} href="/partners/payouts" caption="Commission in the payout cycle" />
        <Kpi label={`Paid · ${monthLabel(month)}`} value={formatCurrency(o.paidThisMonth)} href={`/partners/payouts?month=${month}`} caption="This month's payout cycle" />
        <Kpi label="Rules" value={`${rules.windowDays} days`} href="/partners/rules" caption={`Purchase window · a bill in the last ${rules.lookbackYears} years makes a number ineligible`} />
      </KpiGrid>

      <section className={`${card} flex flex-wrap items-center justify-between gap-3 p-5`}>
        <div className="min-w-0">
          <p className={eyebrow}>Partner application form (public)</p>
          <p className="mt-1 break-all text-sm text-ink">{applyLink}</p>
        </div>
        <div className="flex gap-2">
          <a href="/deepampartner" target="_blank" rel="noreferrer" className={button}>Open form</a>
          <WhatsAppShare text={`Become a Deepam Partner: refer your clients to Deepam and earn on every purchase. Apply here: ${applyLink}`} label="Share form" />
        </div>
      </section>

      <SectionLabel>By category</SectionLabel>
      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '40rem' }}>
            <thead><tr className={eyebrow}>{['Category', 'Active partners', 'Referred', 'Purchased', 'Bills'].map((h, i) =>
              <th key={h} scope="col" className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {o.byCategory.length === 0 && <tr><td colSpan={5} className={`${td} py-6 text-center text-ink-muted`}>No partners yet. Share the application form to start.</td></tr>}
              {o.byCategory.map((c) => (
                <tr key={c.category} className="border-t border-grid hover:bg-inset/50">
                  <th scope="row" className={`${td} text-left font-medium text-ink`}><Link href={`/partners/list?category=${encodeURIComponent(c.category)}`} className="hover:text-accent hover:underline">{c.category}</Link></th>
                  <td className={`tnum ${td} text-right`}>{formatNumber(c.partners)}</td>
                  <td className={`tnum ${td} text-right`}>{formatNumber(c.referrals)}</td>
                  <td className={`tnum ${td} text-right`}>{formatNumber(c.converted)}</td>
                  <td className={`tnum ${td} text-right`}>{formatCurrency(c.salesValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SectionLabel>Top partners</SectionLabel>
      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '40rem' }}>
            <thead><tr className={eyebrow}>{['Partner', 'Category', 'Referred', 'Purchased', 'Bills'].map((h, i) =>
              <th key={h} scope="col" className={`${th} ${i > 1 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {o.topPartners.length === 0 && <tr><td colSpan={5} className={`${td} py-6 text-center text-ink-muted`}>No approved partners yet.</td></tr>}
              {o.topPartners.map((p) => (
                <tr key={p.id} className="border-t border-grid hover:bg-inset/50">
                  <th scope="row" className={`${td} text-left font-medium text-ink`}><Link href={`/partners/${p.code ?? p.id}`} className="hover:text-accent hover:underline">{p.name}</Link> <span className="tnum text-xs text-ink-muted">{p.code}</span></th>
                  <td className={`${td} text-ink-2`}>{p.category}</td>
                  <td className={`tnum ${td} text-right`}>{formatNumber(p.referrals)}</td>
                  <td className={`tnum ${td} text-right`}>{formatNumber(p.converted)}</td>
                  <td className={`tnum ${td} text-right`}>{formatCurrency(p.salesValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
