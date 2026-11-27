import type { Metadata } from 'next';
import Link from 'next/link';
import { monthLabel } from '@/lib/partners/constants';
import { rulesFor, scheduledVersions, type RuleLevel, type RuleTerms } from '@/lib/partners/rules';
import { partnerPath } from '@/lib/partners/site';
import { btn, frame, heading, kicker, page, tile } from '../styles';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Programme rules · Deepam Partners',
  description: 'How the Deepam Partner Programme works: commission levels, referral validity, monthly bonuses, personal shopping and when partners are paid.',
  robots: { index: true, follow: true },
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const ord = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/*
 * The public programme rules, written from the rules version in force (Partner Network → Rules in the CRM), so the
 * page changes when the rules do. Wording follows what the backend does (drizzle/0048): the month's referred sales
 * set that month's commission rate for the whole month; the bonus is the level reached; the partnership level is a
 * rolling-average review that rises at once and falls only after several reviews below.
 */
export default async function PartnerRulesPage() {
  const [rules, next, apply] = await Promise.all([rulesFor(), scheduledVersions(), partnerPath('/')]);
  const t: RuleTerms = rules.terms;
  const levels = [...rules.levels].sort((a, b) => a.level - b.level);
  const bonus = levels.some((l) => l.bonus > 0);
  const discount = levels.some((l) => l.personalDiscount > 0);
  const upcoming = next.find((v) => v.effectiveMonth > rules.effectiveMonth);

  return (
    <main className={page}>
      <div className="mx-auto mb-10 max-w-[760px] text-center">
        <p className={`${kicker} mb-3`}>Partner Programme</p>
        <h1 className={`${heading} mb-4`}>Programme <strong className="font-bold">rules</strong></h1>
        <p>How you earn as a Deepam Partner, how your level works and when you are paid. These are the rules in force from {monthLabel(rules.effectiveMonth)}.</p>
        {upcoming && <p className="mt-3 text-[#7f1835]">Updated rules apply from {monthLabel(upcoming.effectiveMonth)}; this page will show them from then.</p>}
      </div>

      <div className="mx-auto max-w-[960px] space-y-8">
        <section className={frame}>
          <h2 className="mb-4 text-lg font-semibold">Commission levels</h2>
          <p className="mb-5">Each month, the total of your referred customers&apos; purchases decides your commission rate for that month. The rate applies to the whole month&apos;s referred sales, not slab by slab.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.12em] text-[#7f1835]">
                  <th className="pb-3 pr-4 font-semibold">Level</th>
                  <th className="pb-3 pr-4 font-semibold">Referred sales in the month</th>
                  <th className="pb-3 pr-4 font-semibold">Commission</th>
                  {bonus && <th className="pb-3 pr-4 font-semibold">Monthly bonus</th>}
                  {discount && <th className="pb-3 pr-4 font-semibold">Personal discount</th>}
                </tr>
              </thead>
              <tbody>
                {levels.map((l: RuleLevel, i) => (
                  <tr key={l.level} className="border-t border-[#efe7da] align-top">
                    <td className="py-3 pr-4"><span className="font-semibold">{l.name}</span>{l.benefits && <span className="mt-0.5 block text-xs text-[#5c5c5c]">{l.benefits}</span>}</td>
                    <td className="py-3 pr-4">{i === 0 ? `Up to ${inr((levels[1]?.minSales ?? 0) - 1)}` : levels[i + 1] ? `${inr(l.minSales)} – ${inr(levels[i + 1].minSales - 1)}` : `${inr(l.minSales)} and above`}</td>
                    <td className="py-3 pr-4 font-semibold text-[#7f1835]">{pct(l.commissionPercent)}</td>
                    {bonus && <td className="py-3 pr-4">{l.bonus > 0 ? inr(l.bonus) : '—'}</td>}
                    {discount && <td className="py-3 pr-4">{l.personalDiscount > 0 ? pct(l.personalDiscount) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bonus && <p className="mt-4 text-[#5c5c5c]">The monthly bonus is the one for the highest level your month&apos;s referred sales reach; you get one bonus a month, not one per level.</p>}
          <p className="mt-2 text-[#5c5c5c]">Some sales events and campaigns pay their own rate, and some may not count towards your level or bonus. We tell partners before such an event starts.</p>
        </section>

        <div className="grid gap-8 md:grid-cols-2">
          <section className={`${tile} px-6 py-6`}>
            <h2 className="mb-3 text-base font-semibold">Referrals</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Share your own referral link, or ask your client to give your Partner ID at billing.</li>
              <li>A referral counts for purchases made within <strong className="font-semibold">{t.referralDays} days</strong> of the client registering through you.</li>
              {t.existingCustomers !== false && <li>If the client has shopped with Deepam in the last {t.lookbackYears} {t.lookbackYears === 1 ? 'year' : 'years'}, our team verifies the referral before their purchases count.</li>}
              <li>Commission is on the purchase value after discounts, returns and exchanges. A returned purchase does not earn.</li>
              <li>If two partners refer the same client, the earlier valid registration counts, unless our team agrees a split.</li>
            </ul>
          </section>
          <section className={`${tile} px-6 py-6`}>
            <h2 className="mb-3 text-base font-semibold">Your partnership level</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Your level is reviewed every month on your average referred sales over the last {t.reviewMonths} {t.reviewMonths === 1 ? 'month' : 'months'}.</li>
              <li>You move up as soon as your average qualifies.</li>
              <li>You move down only after {t.downgradeAfter} {t.downgradeAfter === 1 ? 'review' : 'reviews in a row'} below your level.</li>
              {discount && <li>Your level sets your personal shopping discount: up to {inr(t.annualShoppingLimit)} of your own purchases a year, confirmed at billing with a one-time code to your phone. Your own purchases do not earn commission.</li>}
            </ul>
          </section>
        </div>

        <section className={frame}>
          <h2 className="mb-4 text-lg font-semibold">When you are paid</h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              [`By the ${ord(t.verifyByDay)}`, 'We check the previous month’s referred purchases and prepare your statement.'],
              [`By the ${ord(t.approveByDay)}`, 'Management approves the statement.'],
              [`By the ${ord(t.payByDay)}`, 'The approved amount is paid to your bank account.'],
            ].map(([when, what], i) => (
              <li key={when} className={`${tile} px-5 py-5`}>
                <span className="mb-2 flex size-8 items-center justify-center rounded-full border border-[#7f1835]/30 text-sm font-semibold text-[#7f1835]">{i + 1}</span>
                <p className="font-semibold">{when}</p>
                <p className="mt-1 text-[#5c5c5c]">{what}</p>
              </li>
            ))}
          </ol>
          <ul className="mt-5 list-disc space-y-2 pl-5">
            {t.minPayout > 0 && <li>Statements under {inr(t.minPayout)} are carried forward to the next month.</li>}
            {t.tdsPercent > 0 && <li>TDS of {pct(t.tdsPercent)} is deducted as required by income tax rules once your earnings in the financial year (April to March) cross {inr(t.tdsAnnualThreshold)}.</li>}
            <li>Very large purchases (from {inr(t.largeBillFlag)}) are reviewed before they count; this can take a little longer.</li>
            <li>Your signed partner agreement, PAN, ID proof and bank details (a cancelled cheque) must be with us before your first payment.</li>
          </ul>
        </section>

        <section className={`${tile} px-6 py-6`}>
          <h2 className="mb-3 text-base font-semibold">Fair play</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Refer real clients. Registering yourself, family or staff as referred clients, or registering clients you did not refer, is not allowed.</li>
            <li>Do not offer discounts or promises on Deepam&apos;s behalf, and do not use Deepam&apos;s name in paid ads without our written agreement.</li>
            <li>We may hold commission on a purchase while we look into it, and withhold commission or end a partnership where the rules are not followed.</li>
            <li>We may change these rules. Changes apply from the first day of a month and never reduce commission already earned.</li>
          </ul>
        </section>

        <div className="pt-2 text-center">
          <Link href={apply} className={btn}>Become a Deepam Partner</Link>
          <p className="mt-4 text-xs text-[#5c5c5c]">Questions? Ask the Deepam team at any of our stores, or reply to your partner welcome message.</p>
        </div>
      </div>
    </main>
  );
}
