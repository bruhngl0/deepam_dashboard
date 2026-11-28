/**
 * Monthly settlement statements (program rules §§12–14): one per partner and completed month. Accounts verify,
 * management approve, accounts record the payment. Months before settlements began are on the old Payouts page.
 */

import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireUser } from '@/lib/auth';
import { monthLabel } from '@/lib/partners/constants';
import { pickMonth } from '@/lib/module-filters';
import { entityReport, settlements } from '@/lib/partners/program-queries';
import { refreshReferrals, rowsOf } from '@/lib/partners/store';
import { rulesFor, shiftMonth, thisMonthIst } from '@/lib/partners/rules';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Callout, Empty, Icon, Notices, Panel, PartnerHeader, Stat, td, th, tr, Who } from '../ui';
import { SettlementBadge } from './status';

export const dynamic = 'force-dynamic';

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  // Statements exist for completed months: without a month asked for, last month.
  const month = sp.month || sp.from || sp.to ? pickMonth(sp) : shiftMonth(thisMonthIst(), -1);
  const [{ v: from }] = rowsOf<{ v: string }>(await db.execute(sql`SELECT COALESCE((SELECT value #>> '{}' FROM settings WHERE key = 'partner_settlements_from'), '2026-11') AS v`));
  const [lines, entities, rules] = await Promise.all([settlements(month), entityReport(month), rulesFor(month)]);
  const open = month >= thisMonthIst();
  const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + f(l), 0);
  const outstanding = sum((l) => (['approved', 'partially_paid', 'on_hold'].includes(l.status) ? l.net - l.paid : 0));
  const t = rules.terms;

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="wallet" eyebrow="Ananta Partner Network" title={`Settlements · ${monthLabel(month)}`}
        description={`Each partner's statement for the month: commission, bonus, collaborations, incentives and adjustments, less TDS (${t.tdsPercent ?? 2}%). Accounts verify by the ${t.verifyByDay ?? 5}th, management approve by the ${t.approveByDay ?? 10}th, paid by the ${t.payByDay ?? 15}th.`}
        actions={<span className="inline-flex overflow-hidden rounded-xl border border-line bg-surface shadow-sm"><Link href={`/partners/settlements?month=${shiftMonth(month, -1)}`} className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-ink hover:bg-inset"><Icon name="left" />{monthLabel(shiftMonth(month, -1))}</Link><Link href={`/partners/settlements?month=${shiftMonth(month, 1)}`} className="inline-flex items-center gap-1 border-l border-line px-3 py-2 text-sm font-medium text-ink hover:bg-inset">{monthLabel(shiftMonth(month, 1))}<Icon name="right" /></Link></span>} />
      <Notices sp={sp} />
      {month < from && <Callout tone="info" title={`Settlement statements start from ${monthLabel(from)}`}>Earlier months were paid on the <Link href={`/partners/payouts?month=${month}`} className="underline">Payouts</Link> page.</Callout>}
      {open && <Callout tone="info" title={`${monthLabel(month)} has not ended`}>Statements are created on the 1st of next month. Partners see this month as an estimate on their dashboards.</Callout>}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat icon="clock" tone="wait" label="To verify" value={formatNumber(lines.filter((l) => l.status === 'pending_verification').length)} caption={formatCurrency(sum((l) => (l.status === 'pending_verification' ? l.net : 0)))} />
        <Stat icon="check" tone="info" label="To approve" value={formatNumber(lines.filter((l) => l.status === 'pending_approval').length)} caption={formatCurrency(sum((l) => (l.status === 'pending_approval' ? l.net : 0)))} />
        <Stat icon="wallet" tone="wait" label="Approved, unpaid" value={formatCurrency(outstanding)} highlight={outstanding > 0} caption={`${formatNumber(lines.filter((l) => ['approved', 'partially_paid'].includes(l.status)).length)} statements`} />
        <Stat icon="rupee" tone="good" label="Paid" value={formatCurrency(sum((l) => l.paid))} caption={`TDS ${formatCurrency(sum((l) => (l.status === 'pending_verification' ? 0 : l.tds)))}`} />
      </div>

      <Panel title="Statements" icon="receipt" count={lines.length} flush>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '72rem' }}>
            <thead><tr>{['Partner', 'Status', 'Eligible sales', 'Commission', 'Bonus', 'Collab & incentives', 'Opening & adjustments', 'TDS', 'Net payable', 'Paid'].map((h, i) =>
              <th key={h} scope="col" className={`${th} ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={10}><Empty icon="wallet">No statements for {monthLabel(month)}.</Empty></td></tr>}
              {lines.map((l) => (
                <tr key={l.id} className={tr}>
                  <th scope="row" className={`${td} text-left font-normal`}><Who name={l.partnerName} sub={l.partnerCode ?? ''} href={`/partners/settlements/${l.id}`} /></th>
                  <td className={td}><SettlementBadge status={l.status} />{l.heldLines > 0 && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">{l.heldLines} bill{l.heldLines === 1 ? '' : 's'} on hold</span>}{!l.documentsComplete && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">Documents pending</span>}</td>
                  <td className={`tnum ${td} text-right`}>{formatCurrency(l.eligibleSales)}{l.level && <span className="block text-xs text-ink-muted">Level {l.level} · {l.percent}%</span>}</td>
                  <td className={`tnum ${td} text-right`}>{formatCurrency(l.standard + l.campaign)}{l.campaign > 0 && <span className="block text-xs text-ink-muted">{formatCurrency(l.campaign)} campaign</span>}</td>
                  <td className={`tnum ${td} text-right`}>{l.bonus ? formatCurrency(l.bonus) : '—'}</td>
                  <td className={`tnum ${td} text-right`}>{l.collab + l.incentives ? formatCurrency(l.collab + l.incentives) : '—'}</td>
                  <td className={`tnum ${td} text-right`}>{l.opening || l.adjustments ? formatCurrency(l.opening + l.adjustments) : '—'}</td>
                  <td className={`tnum ${td} text-right`}>{l.tds ? formatCurrency(l.tds) : '—'}</td>
                  <td className={`tnum ${td} text-right font-medium ${l.net < 0 ? 'text-red-700 dark:text-red-300' : 'text-ink'}`}>{formatCurrency(l.net)}</td>
                  <td className={`tnum ${td} text-right`}>{l.paid ? formatCurrency(l.paid) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="By entity" description="Commission to the entity where the sale was made; bonus in proportion to each entity's qualifying sales; collaborations to the brand that approved them. Store → entity is set on Programs." icon="grid" flush>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr>{['Entity', 'Eligible sales', 'Commission', 'Bonus', 'Collaborations', 'Incentives', 'Adjustments', 'Total expense'].map((h, i) =>
              <th key={h} scope="col" className={`${th} ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {entities.length === 0 && <tr><td colSpan={8}><Empty icon="grid">Nothing to allocate yet.</Empty></td></tr>}
              {entities.map((e) => (
                <tr key={e.entity} className={tr}>
                  <th scope="row" className={`${td} text-left font-medium text-ink`}>{e.entity}</th>
                  {[e.sales, e.commission, e.bonus, e.collab, e.incentives, e.adjustments, e.total].map((v, i) => <td key={i} className={`tnum ${td} text-right ${i === 6 ? 'font-medium text-ink' : ''}`}>{formatCurrency(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}
