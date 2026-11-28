/**
 * Rules & Configuration (program rules v1.0 §22–23): the levels table, referral and review terms, partner categories,
 * and every version with what changed, who changed it and why. A save is a new version from a chosen month.
 */

import { requireUser } from '@/lib/auth';
import { monthLabel } from '@/lib/partners/constants';
import { categories, ruleHistory, rulesFor, scheduledVersions, shiftMonth, thisMonthIst, versionChanges } from '@/lib/partners/rules';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { button, control, primaryButton } from '@/components/ui';
import { cancelRulesAction, categoryAction, rulesAction } from '../actions';
import { Icon, Notices, Panel, PartnerHeader, td, th, tr } from '../ui';

export const dynamic = 'force-dynamic';

export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const month = thisMonthIst();
  const [current, history, scheduled, cats, sp] = await Promise.all([rulesFor(month), ruleHistory(), scheduledVersions(), categories(), searchParams]);
  // Edit from the latest saved rules (a scheduled version if there is one), so a second change builds on the first.
  const base = scheduled.at(-1) ?? current;
  const field = `${control} w-full`;
  const num = `${field} text-right tnum`;
  const months = [0, 1, 2, 3].map((k) => shiftMonth(month, k));
  const ordered = [...history].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="sliders" eyebrow="Ananta Partner Network" title="Rules & configuration"
        description="Commission is worked out per calendar month: a partner's eligible sales for the month (before GST, less returns) decide the level, and that level's % applies to the whole month, plus its bonus. The partnership level (personal discount and benefits) is reviewed at each month end." />
      <Notices sp={sp} />

      {scheduled.length > 0 && (
        <Panel title="Changes waiting to take effect" icon="calendar" tone="wait">
          <ul className="space-y-3 text-sm">
            {scheduled.map((v) => (
              <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-inset/50 px-4 py-3">
                <div>
                  <p className="font-medium text-ink">From {monthLabel(v.effectiveMonth)} · {v.reason} <span className="font-normal text-ink-muted">({v.changedBy})</span></p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-ink-2">{versionChanges(current, v).map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
                <form action={cancelRulesAction}><input type="hidden" name="version" value={v.id} /><input type="hidden" name="back" value="/partners/rules" /><button type="submit" className={button}>Cancel</button></form>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <form action={rulesAction} className="space-y-6">
        <input type="hidden" name="back" value="/partners/rules" />
        <Panel title="Levels" icon="rupee" flush
          description={<>In force for {monthLabel(month)}: version {current.id}, from {monthLabel(current.effectiveMonth)}. A level holds from its minimum up to the next level&rsquo;s. Commission level and bonus come from the month&rsquo;s own sales; personal discount from the partnership level.</>}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" style={{ minWidth: '72rem' }}>
              <thead><tr>
                {['Level', 'Name', 'Monthly eligible sales from (₹)', 'Commission %', 'Monthly bonus (₹)', 'Influencer fee limit (₹)', 'Personal discount %', 'Other benefits'].map((h, i) =>
                  <th key={h} scope="col" className={`${th} ${i >= 2 && i <= 6 ? 'text-right' : 'text-left'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {base.levels.map((l) => (
                  <tr key={l.level} className={tr}>
                    <td className={`tnum ${td} py-3`}><span className="inline-flex size-7 items-center justify-center rounded-full bg-accent-soft/50 text-xs font-semibold text-accent">{l.level}</span></td>
                    <td className={td}><input name={`name_${l.level}`} defaultValue={l.name} maxLength={60} className={field} aria-label={`Level ${l.level} name`} /></td>
                    <td className={td}>{l.level === 1
                      ? <span className="tnum block px-3 text-right text-ink-2">0</span>
                      : <input name={`min_${l.level}`} type="number" min={0} step={1} required defaultValue={l.minSales} className={num} aria-label={`Level ${l.level} minimum monthly sales`} />}</td>
                    <td className={td}><input name={`percent_${l.level}`} type="number" min={0} max={100} step={0.01} required defaultValue={l.commissionPercent} className={num} aria-label={`Level ${l.level} commission percent`} /></td>
                    <td className={td}><input name={`bonus_${l.level}`} type="number" min={0} step={1} required defaultValue={l.bonus} className={num} aria-label={`Level ${l.level} bonus`} /></td>
                    <td className={td}><input name={`influencer_${l.level}`} type="number" min={0} step={1} required defaultValue={l.influencerLimit} className={num} aria-label={`Level ${l.level} influencer fee limit`} /></td>
                    <td className={td}><input name={`discount_${l.level}`} type="number" min={0} max={100} step={0.01} required defaultValue={l.personalDiscount} className={num} aria-label={`Level ${l.level} personal discount`} /></td>
                    <td className={td}><input name={`benefits_${l.level}`} defaultValue={l.benefits} maxLength={300} placeholder="e.g. priority access" className={field} aria-label={`Level ${l.level} other benefits`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Referrals" icon="link">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-ink">Referral validity (days)
                <input name="referralDays" type="number" min={1} max={365} required defaultValue={base.terms.referralDays} className={`${field} mt-1`} />
                <span className="mt-1 block text-xs text-ink-muted">Purchases within this many days of registering earn. It does not extend with each purchase.</span>
              </label>
              <label className="text-sm text-ink">Existing customer look-back (years)
                <input name="lookbackYears" type="number" min={1} max={10} required defaultValue={base.terms.lookbackYears} className={`${field} mt-1`} />
                <span className="mt-1 block text-xs text-ink-muted">A number that bought in this many years is an existing customer: it can be referred, but staff verify the partner&rsquo;s part before it earns.</span>
              </label>
            </div>
          </Panel>
          <Panel title="Partnership level review" icon="calendar">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-sm text-ink">Months averaged
                <input name="reviewMonths" type="number" min={1} max={12} required defaultValue={base.terms.reviewMonths} className={`${field} mt-1`} />
              </label>
              <label className="text-sm text-ink">Reviews below before a downgrade
                <input name="downgradeAfter" type="number" min={1} max={12} required defaultValue={base.terms.downgradeAfter} className={`${field} mt-1`} />
              </label>
              <label className="text-sm text-ink">Annual personal shopping limit (₹)
                <input name="annualShoppingLimit" type="number" min={0} step={1} required defaultValue={base.terms.annualShoppingLimit} className={`${field} mt-1`} />
              </label>
            </div>
            <p className="mt-3 text-xs text-ink-muted">At each month end: the average of the last completed months (the approval month never counts; months with no sales count as zero). Upgrades straight away; downgrades only after this many reviews in a row below. The new level holds from the next month.</p>
          </Panel>
        </div>

        <Panel title="Settlement" icon="wallet">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-7">
            {([
              ['tdsPercent', 'TDS %', base.terms.tdsPercent ?? 2, 0.01, 'On commission (s.194H).'],
              ['tdsAnnualThreshold', 'TDS from (₹ a year)', base.terms.tdsAnnualThreshold ?? 20000, 1, 'Once the financial year total passes this; the year so far is caught up.'],
              ['minPayout', 'Minimum payout (₹)', base.terms.minPayout ?? 0, 1, 'Below this the balance carries forward.'],
              ['largeBillFlag', 'Review bills from (₹)', base.terms.largeBillFlag ?? 500000, 1, 'A single referred bill this large is flagged.'],
              ['verifyByDay', 'Accounts verify by (day)', base.terms.verifyByDay ?? 5, 1, 'Of the following month.'],
              ['approveByDay', 'Management approve by', base.terms.approveByDay ?? 10, 1, ''],
              ['payByDay', 'Paid by', base.terms.payByDay ?? 15, 1, ''],
            ] as const).map(([name, label, value, step, hint]) => (
              <label key={name} className="text-sm text-ink">{label}
                <input name={name} type="number" min={0} step={step} required defaultValue={value} className={`${field} mt-1`} />
                {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
              </label>
            ))}
          </div>
        </Panel>

        <Panel title="Save as a new version" icon="check" tone="good">
          <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)_14rem_auto] md:items-end">
            <label className="text-sm text-ink">Takes effect from
              <select name="effectiveMonth" defaultValue={months[1]} className={`${field} mt-1`}>
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === month ? ' (this month)' : ''}</option>)}
              </select>
            </label>
            <label className="text-sm text-ink">Reason for the change
              <input name="reason" required maxLength={300} placeholder="e.g. Management decision of 1 December" className={`${field} mt-1`} />
            </label>
            <label className="text-sm text-ink">Your name
              <input name="by" required maxLength={80} autoComplete="name" className={`${field} mt-1`} />
            </label>
            <button type="submit" className={primaryButton}><Icon name="check" />Save rules</button>
          </div>
          <p className="mt-3 text-xs text-ink-muted">Slab and bonus changes normally start with a new month. A month that has ended keeps the rules it was earned under.</p>
        </Panel>
      </form>

      <Panel title="Partner categories" icon="grid" flush description="The categories offered on the application form. Hiding one keeps it on partners who already have it.">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '44rem' }}>
            <thead><tr>{['Category', 'Partners', 'On the form', 'Rename'].map((h, i) => <th key={h} scope="col" className={`${th} ${i === 1 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.name} className={tr}>
                  <td className={`${td} ${c.active ? 'text-ink' : 'text-ink-muted line-through'}`}>{c.name}</td>
                  <td className={`tnum ${td} text-right`}>{c.partners}</td>
                  <td className={td}>
                    <form action={categoryAction}>
                      <input type="hidden" name="back" value="/partners/rules" /><input type="hidden" name="name" value={c.name} /><input type="hidden" name="op" value={c.active ? 'hide' : 'show'} />
                      <button type="submit" className="text-xs text-ink-2 hover:text-ink hover:underline">{c.active ? 'Shown · hide' : 'Hidden · show'}</button>
                    </form>
                  </td>
                  <td className={td}>
                    <form action={categoryAction} className="flex gap-1">
                      <input type="hidden" name="back" value="/partners/rules" /><input type="hidden" name="name" value={c.name} /><input type="hidden" name="op" value="rename" />
                      <input name="to" required maxLength={60} defaultValue={c.name} className={`${control} py-1 text-xs`} aria-label={`New name for ${c.name}`} />
                      <button type="submit" className="rounded-lg border border-line px-2 text-xs text-ink-2 hover:bg-inset">Rename</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={categoryAction} className="flex flex-wrap gap-2 border-t border-grid px-5 py-4">
          <input type="hidden" name="back" value="/partners/rules" /><input type="hidden" name="op" value="add" />
          <input name="name" required maxLength={60} placeholder="New category" className={`${control} w-64`} aria-label="New category" />
          <button type="submit" className={button}>Add category</button>
        </form>
      </Panel>

      <Panel title="Version history" icon="clock" flush description="Every saved version: when it takes effect, what changed from the one before, who and why.">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '60rem' }}>
            <thead><tr>{['Version', 'In force from', 'What changed', 'Reason', 'By', 'Saved'].map((h) => <th key={h} scope="col" className={`${th} text-left`}>{h}</th>)}</tr></thead>
            <tbody>
              {history.map((v) => {
                const prev = ordered[ordered.findIndex((x) => x.id === v.id) - 1];
                return (
                  <tr key={v.id} className={tr}>
                    <td className={`tnum ${td}`}>{v.id}{v.id === current.id && <span className="ml-2 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">in force</span>}</td>
                    <td className={`${td} text-ink-2`}>{monthLabel(v.effectiveMonth)}</td>
                    <td className={`${td} text-xs text-ink-2`}><ul className="space-y-0.5">{versionChanges(prev, v).map((c) => <li key={c}>{c}</li>)}</ul></td>
                    <td className={`${td} text-ink-2`}>{v.reason}</td>
                    <td className={`${td} text-ink-2`}>{v.changedBy}</td>
                    <td className={`tnum ${td} text-ink-muted`}>{formatDateTime(v.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="text-xs text-ink-muted">Example under the rules in force: ₹8,00,000 of eligible sales in a month reaches {(() => {
        const l = [...current.levels].sort((a, b) => b.minSales - a.minSales).find((x) => 800000 >= x.minSales)!;
        return `${l.name}: ${l.commissionPercent}% of ₹8,00,000 = ${formatCurrency(8000 * l.commissionPercent)} plus a ${formatCurrency(l.bonus)} bonus`;
      })()}.</p>
    </main>
  );
}
