/** The partner terms still being decided: commission % for the five levels, the purchase window and the look-back. */

import { requireUser } from '@/lib/auth';
import { getRules } from '@/lib/partners/queries';
import { control, primaryButton } from '@/components/ui';
import { rulesAction } from '../actions';
import { Icon, Notices, Panel, PartnerHeader, td, th, tr } from '../ui';

export const dynamic = 'force-dynamic';

export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const [rules, sp] = await Promise.all([getRules(), searchParams]);
  const field = `${control} w-full`;

  return (
    <main className="mx-auto w-full max-w-[64rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="sliders" eyebrow="Ananta Partner Network" title="Rules" description="Commission levels and referral terms. Changes apply from now on: a referral keeps the purchase window it registered with, and a validated bill keeps its rate." />
      <Notices sp={sp} />
      <form action={rulesAction} className="space-y-6">
        <input type="hidden" name="back" value="/partners/rules" />
        <Panel title="Commission levels" icon="rupee" flush description={<>Commission is this percentage of the bill amount on the POS bill. A level left empty is not decided: its partners&rsquo; bills are matched and wait under Referrals until it is set.</>}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '40rem' }}>
            <thead><tr>
              <th scope="col" className={`${th} w-20 text-left`}>Level</th>
              <th scope="col" className={`${th} text-left`}>Name</th>
              <th scope="col" className={`${th} w-40 text-right`}>Commission % of bill</th>
              <th scope="col" className={`${th} text-left`}>Notes (who gets it)</th>
            </tr></thead>
            <tbody>
              {rules.levels.map((l) => (
                <tr key={l.level} className={tr}>
                  <td className={`tnum ${td} py-3`}><span className={`inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold ${l.percent === null ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-accent-soft/50 text-accent'}`}>{l.level}</span></td>
                  <td className={td}><input name={`name_${l.level}`} defaultValue={l.name} maxLength={60} className={field} aria-label={`Level ${l.level} name`} /></td>
                  <td className={td}><input name={`percent_${l.level}`} type="number" min={0} max={100} step={0.01} defaultValue={l.percent ?? ''} placeholder="To be decided" className={`${field} text-right`} aria-label={`Level ${l.level} commission percent`} /></td>
                  <td className={td}><input name={`notes_${l.level}`} defaultValue={l.notes ?? ''} maxLength={300} className={field} aria-label={`Level ${l.level} notes`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </Panel>

        <Panel title="Referral terms" icon="calendar">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-ink">Purchase window (days)
            <input name="windowDays" type="number" min={1} max={365} required defaultValue={rules.windowDays} className={`${field} mt-1`} />
            <span className="mt-1 block text-xs text-ink-muted">A bill counts only if it is dated within this many days of the customer registering.</span>
          </label>
          <label className="text-sm text-ink">Look-back for existing customers (years)
            <input name="lookbackYears" type="number" min={1} max={10} required defaultValue={rules.lookbackYears} className={`${field} mt-1`} />
            <span className="mt-1 block text-xs text-ink-muted">A number with a bill in this many past years (CRM bills or the loyalty list) is already a customer and cannot be registered.</span>
          </label>
        </div>
        </Panel>
        <button type="submit" className={primaryButton}><Icon name="check" />Save rules</button>
      </form>
    </main>
  );
}
