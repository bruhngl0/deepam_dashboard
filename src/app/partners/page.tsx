/**
 * Ananta Partner Network overview: applications waiting, partners, referrals and how many bought, commission to validate,
 * to pay and paid this month, then results by category and the top partners.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { monthLabel } from '@/lib/partners/constants';
import { partnerLinkBase } from '@/lib/partners/links';
import { getRules, overview } from '@/lib/partners/queries';
import { refreshReferrals } from '@/lib/partners/store';
import { todayIst } from '@/lib/queries/daily';
import { pickRange, pickStores, rangeLabel } from '@/lib/module-filters';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '@/lib/format';
import { button, primaryButton } from '@/components/ui';
import { WhatsAppShare } from '@/components/whatsapp-share';
import { Bar, Callout, Empty, Icon, Panel, PanelLink, PartnerHeader, Stat, td, th, tr, Who } from './ui';

export const dynamic = 'force-dynamic';

export default async function PartnersOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  const { from, to } = pickRange(sp, { from: null, to: null });
  const stores = pickStores(sp);
  const month = (to ?? todayIst()).slice(0, 7);
  const carry = new URLSearchParams(Object.entries({ store: stores ?? '', from: from ?? '', to: to ?? '' }).filter(([, v]) => v)).toString();
  const withScope = (href: string) => (carry ? `${href}${href.includes('?') ? '&' : '?'}${carry}` : href);
  const [o, rules, base] = await Promise.all([overview({ from, to, stores }), getRules(), partnerLinkBase()]);
  const ratesMissing = rules.levels.filter((l) => l.percent === null).length;
  const applyLink = base;

  const maxCat = Math.max(0, ...o.byCategory.map((c) => c.referrals));
  const maxTop = Math.max(0, ...o.topPartners.map((p) => p.salesValue));

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="handshake" title="Ananta Partner Network" description="Deepam Partners: applications, referral links, referred customers and monthly commission payouts."
        meta={`Referrals and bills: ${rangeLabel(from, to)}${stores ? ' · filtered by store' : ''}`}
        actions={<><Link href="/partners/list?status=applied" className={button}><Icon name="inbox" />Review applications{o.applied > 0 && <span className="tnum rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">{o.applied}</span>}</Link><Link href={withScope("/partners/referrals")} className={primaryButton}><Icon name="check" />Validate bills</Link></>} />

      {ratesMissing > 0 && (
        <Callout tone="wait" title={`Commission % is not set for ${ratesMissing} of the 5 levels`}>
          Bills are still matched, but cannot be validated for payout until the partner&rsquo;s level has a rate. <Link href="/partners/rules" className="font-medium underline">Set the rules</Link>
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon="inbox" tone="wait" label="Applications to review" value={formatNumber(o.applied)} href="/partners/list?status=applied" caption={`${formatNumber(o.rejected)} rejected so far`} highlight={o.applied > 0} />
        <Stat icon="users" label="Active partners" value={formatNumber(o.approved)} href="/partners/list?status=approved" caption={o.suspended ? `${formatNumber(o.suspended)} suspended` : 'Approved, link accepting registrations'} />
        <Stat icon="link" tone="info" label="Referred customers" value={formatNumber(o.referrals)} href={withScope("/partners/referrals")}
          caption={`${formatNumber(o.open)} inside the ${rules.windowDays}-day window · ${formatNumber(o.declined)} not accepted`} />
        <Stat icon="bag" tone="good" label="Purchased" value={formatNumber(o.converted)} href={withScope("/partners/referrals?status=converted")}
          caption={`${formatPercent(o.converted, o.converted + o.expired)} of closed windows · ${formatCurrencyCompact(o.salesValue)} in bills`} />
        <Stat icon="receipt" tone="wait" label="Bills to validate" value={formatNumber(o.toValidate)} href={withScope("/partners/referrals")} caption={`${formatCurrencyCompact(o.toValidateValue)} in bills, matched to referrals`} highlight={o.toValidate > 0} />
        <Stat icon="wallet" tone="info" label="Validated, not yet paid" value={formatCurrency(o.validatedUnpaid)} href="/partners/payouts" caption="Commission in the payout cycle" />
        <Stat icon="rupee" tone="good" label={from || to || stores ? 'Commission paid' : `Paid · ${monthLabel(month)}`} value={formatCurrency(o.paidThisMonth)} href={`/partners/payouts?month=${month}`} caption={from || to || stores ? 'On bills in the period and stores picked' : 'Commission paid on bills so far'} />
        <Stat icon="sliders" tone="quiet" label="Rules" value={`${rules.windowDays} days`} href="/partners/rules" caption={`Purchase window · a bill in the last ${rules.lookbackYears} years makes a number ineligible`} />
      </div>

      <section className="hero-card flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-5 text-on-dark sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15"><Icon name="share" className="size-5" /></span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-white/60">Partner application form (public)</p>
            <p className="mt-1 break-all text-sm font-medium">{applyLink}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/deepampartner" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium transition-colors hover:bg-white/20">Open form<Icon name="arrow" className="size-3.5" /></a>
          <WhatsAppShare text={`Become a Deepam Partner: refer your clients to Deepam and earn on every purchase. Apply here: ${applyLink}`} label="Share form" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="By category" icon="grid" flush description="Referred customers per partner category">
          {o.byCategory.length === 0 ? <Empty icon="grid">No partners yet. Share the application form to start.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" style={{ minWidth: '36rem' }}>
                <thead><tr>{['Category', 'Partners', 'Referred', 'Purchased', 'Bills'].map((h, i) =>
                  <th key={h} scope="col" className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {o.byCategory.map((c) => (
                    <tr key={c.category} className={tr}>
                      <th scope="row" className={`${td} text-left font-medium text-ink`}>
                        <Link href={`/partners/list?category=${encodeURIComponent(c.category)}`} className="hover:text-accent hover:underline">{c.category}</Link>
                        <span className="mt-1.5 block w-full max-w-[14rem]"><Bar value={c.referrals} max={maxCat} /></span>
                      </th>
                      <td className={`tnum ${td} text-right`}>{formatNumber(c.partners)}</td>
                      <td className={`tnum ${td} text-right`}>{formatNumber(c.referrals)}</td>
                      <td className={`tnum ${td} text-right`}>{formatNumber(c.converted)}</td>
                      <td className={`tnum ${td} text-right font-medium text-ink`}>{formatCurrency(c.salesValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Top partners" icon="trophy" tone="wait" flush description="By value of bills from their referrals" actions={<PanelLink href="/partners/list?status=approved">All partners</PanelLink>}>
          {o.topPartners.length === 0 ? <Empty icon="users">No approved partners yet.</Empty> : (
            <ol className="divide-y divide-grid">
              {o.topPartners.map((p, i) => (
                <li key={p.id} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-inset/50">
                  <span className={`tnum inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i < 3 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-inset text-ink-muted'}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Who name={p.name} sub={`${p.code ?? ''} · ${p.category}`} href={`/partners/${p.code ?? p.id}`} />
                    <span className="mt-2 block pl-10"><Bar value={p.salesValue} max={maxTop} tone="good" /></span>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <div className="tnum font-semibold text-ink">{formatCurrency(p.salesValue)}</div>
                    <div className="tnum text-xs text-ink-muted">{formatNumber(p.converted)} of {formatNumber(p.referrals)} bought</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </main>
  );
}
