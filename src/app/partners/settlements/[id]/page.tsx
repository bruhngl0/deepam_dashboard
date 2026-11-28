/**
 * One settlement statement (program rules §13): opening balance, eligible sales by store, commission level, standard
 * and campaign commission, bonus, collaborations, incentives, adjustments, TDS, net payable, payments and closing
 * balance; the entity allocation; and the next step (verify → approve → pay; hold or send back).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { monthLabel } from '@/lib/partners/constants';
import { adjustments, collaborations, payments, settlement } from '@/lib/partners/program-queries';
import { refreshReferrals } from '@/lib/partners/store';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { button, control, primaryButton } from '@/components/ui';
import { settlementAction } from '../../program-actions';
import { ByField, Callout, Notices, Panel, PartnerHeader, td, th, tr } from '../../ui';
import { SettlementBadge } from '../status';

export const dynamic = 'force-dynamic';

const Row = ({ label, value, strong = false, note }: { label: string; value: number; strong?: boolean; note?: string }) => (
  <div className={`flex items-baseline justify-between gap-4 border-t border-grid py-2 first:border-t-0 ${strong ? 'font-semibold text-ink' : 'text-ink-2'}`}>
    <span>{label}{note && <span className="ml-2 text-xs font-normal text-ink-muted">{note}</span>}</span>
    <span className={`tnum ${value < 0 ? 'text-red-700 dark:text-red-300' : ''}`}>{formatCurrency(value)}</span>
  </div>
);

function Form({ id, back, what, children, label, tone = 'primary' }: { id: number; back: string; what: string; children?: React.ReactNode; label: string; tone?: 'primary' | 'plain' }) {
  return (
    <form action={settlementAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="do" value={what} /><input type="hidden" name="back" value={back} />
      {children}<ByField /><button type="submit" className={tone === 'primary' ? primaryButton : button}>{label}</button>
    </form>
  );
}

export default async function SettlementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const s = await settlement(Number(id));
  if (!s) notFound();
  const [pays, adjs, collabs] = await Promise.all([payments(s.id), adjustments({ settlementId: s.id }), collaborations(s.partnerId)]);
  const back = `/partners/settlements/${s.id}`;
  const outstanding = Math.round((s.net - s.paid) * 100) / 100;
  return (
    <main className="mx-auto w-full max-w-[72rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="receipt" eyebrow={<Link href={`/partners/settlements?month=${s.month}`} className="hover:underline">Settlements · {monthLabel(s.month)}</Link>} title={`${s.partnerName} · ${monthLabel(s.month)}`}
        description={`${s.partnerCode ?? ''} · statement #${s.id} · rules version ${s.ruleVersionId ?? '—'}`} meta={<SettlementBadge status={s.status} />} />
      <Notices sp={sp} />
      {s.holdReason && <Callout tone={s.status === 'on_hold' ? 'bad' : 'info'} title={s.status === 'on_hold' ? 'On hold' : 'Note'}>{s.holdReason}</Callout>}
      {s.adjustedAt && <Callout tone="info" title="Adjusted after settlement">This month was recalculated after it was settled (a return, claim or flag). The difference is an adjustment on the next statement; this statement does not change.</Callout>}
      {s.partnerStatus === 'on_hold' && <Callout tone="wait" title="Partner on hold">Payments are stopped until the partner&rsquo;s review ends.</Callout>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title="Statement" icon="receipt">
          <Row label="Opening balance" value={s.opening} note="carried from the last statement" />
          <div className="flex items-baseline justify-between gap-4 border-t border-grid py-2 text-ink-2">
            <span>Eligible sales <span className="ml-2 text-xs text-ink-muted">net of GST and returns{s.thresholdSales !== s.eligibleSales ? ` · ${formatCurrency(s.thresholdSales)} count towards the slab` : ''}</span></span>
            <span className="tnum">{formatCurrency(s.eligibleSales)}</span>
          </div>
          {Object.entries(s.byStore).map(([store, v]) => <div key={store} className="flex justify-between pl-4 text-xs text-ink-muted"><span>{store}</span><span className="tnum">{formatCurrency(v)}</span></div>)}
          <Row label="Standard commission" value={s.standard} note={s.level ? `Level ${s.level} · ${s.percent}% on the whole month` : undefined} />
          <Row label="Campaign commission" value={s.campaign} />
          <Row label="Monthly bonus" value={s.bonus} />
          <Row label="Collaboration fees" value={s.collab} note="completed and approved" />
          <Row label="Additional incentives" value={s.incentives} />
          <Row label="Adjustments" value={s.adjustments} note="returns after settlement, corrections" />
          <Row label="Gross" value={s.gross + s.adjustments} strong />
          <Row label={`TDS ${s.tdsPercent}%`} value={-s.tds} note={s.tdsBase ? `on ${formatCurrency(s.tdsBase)}` : 'below the annual threshold'} />
          <Row label="Net payable" value={s.net} strong />
          <Row label="Paid" value={-s.paid} />
          <Row label="Closing balance" value={s.closing} strong note={s.status === 'verified' ? 'carried to the next statement' : undefined} />
        </Panel>

        <div className="space-y-6">
          <Panel title="Next step" icon="check" tone="good">
            <div className="space-y-3 text-sm">
              {s.status === 'pending_verification' && <><p className="text-ink-2">Accounts check the bills and amounts, then verify. Verified statements no longer change.</p><Form id={s.id} back={back} what="verify" label="Verify" /></>}
              {s.status === 'pending_approval' && <><p className="text-ink-2">Verified by {s.verifiedBy}. Management approve (someone other than who verified).</p><Form id={s.id} back={back} what="approve" label="Approve" />
                <Form id={s.id} back={back} what="reopen" label="Send back" tone="plain"><input name="reason" required placeholder="Why" className={`${control} w-40 py-1`} /></Form></>}
              {s.status === 'verified' && <><p className="text-ink-2">Nothing to pay this month: the balance of {formatCurrency(s.closing)} carries forward.</p><Form id={s.id} back={back} what="reopen" label="Send back" tone="plain"><input name="reason" required placeholder="Why" className={`${control} w-40 py-1`} /></Form></>}
              {(s.status === 'approved' || s.status === 'partially_paid') && <>
                <p className="text-ink-2">Approved by {s.approvedBy}. {formatCurrency(outstanding)} outstanding.</p>
                {!s.documentsComplete && <p className="text-amber-700 dark:text-amber-300">Collect the partner&rsquo;s documents before paying.</p>}
                <Form id={s.id} back={back} what="pay" label="Record payment">
                  <input name="amount" type="number" step="0.01" min="0.01" max={outstanding} defaultValue={outstanding} required aria-label="Amount" className={`${control} w-32 py-1`} />
                  <input name="paidOn" type="date" aria-label="Paid on" className={`${control} py-1`} />
                  <input name="reference" required maxLength={120} placeholder="UTR / cheque no." aria-label="Payment reference" className={`${control} w-40 py-1`} />
                </Form>
              </>}
              {['pending_approval', 'approved', 'partially_paid'].includes(s.status) && <Form id={s.id} back={back} what="hold" label="Put on hold" tone="plain"><input name="reason" required placeholder="Reason" className={`${control} w-40 py-1`} /></Form>}
              {s.status === 'on_hold' && <Form id={s.id} back={back} what="release" label="Release hold" />}
              {(s.status === 'paid' || s.status === 'adjusted') && <p className="text-ink-2">Settled. Later changes become adjustments on the next statement.</p>}
            </div>
          </Panel>
          <Panel title="By entity" icon="grid">
            {Object.keys(s.allocation).length === 0 ? <p className="text-sm text-ink-muted">Nothing to allocate.</p> : Object.entries(s.allocation).map(([e, a]) => (
              <div key={e} className="border-t border-grid py-2 text-sm first:border-t-0">
                <div className="flex justify-between font-medium text-ink"><span>{e}</span><span className="tnum">{formatCurrency(a.total)}</span></div>
                <div className="text-xs text-ink-muted">Commission {formatCurrency(a.commission)} · bonus {formatCurrency(a.bonus)} · collaborations {formatCurrency(a.collab)} · incentives {formatCurrency(a.incentives)} · adjustments {formatCurrency(a.adjustments)}</div>
              </div>))}
          </Panel>
          <Panel title="Trail" icon="clock">
            <ul className="space-y-1 text-xs text-ink-2">
              {s.verifiedAt && <li>Verified by {s.verifiedBy}, {formatDateTime(s.verifiedAt)}</li>}
              {s.approvedAt && <li>Approved by {s.approvedBy}, {formatDateTime(s.approvedAt)}</li>}
              {pays.map((p) => <li key={p.id}>Paid {formatCurrency(p.amount)} on {formatDate(p.paidOn)} · {p.reference} · {p.by}</li>)}
              {!s.verifiedAt && !pays.length && <li>Not verified yet.</li>}
            </ul>
          </Panel>
        </div>
      </div>

      {adjs.length > 0 && <Panel title="Adjustments on this statement" icon="sliders" flush>
        <table className="w-full border-collapse text-sm"><thead><tr>{['For month', 'Reason', 'By', 'Amount'].map((h, i) => <th key={h} className={`${th} ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody>{adjs.map((a) => <tr key={a.id} className={tr}><td className={td}>{monthLabel(a.month)}</td><td className={td}>{a.reason}</td><td className={td}>{a.kind === 'recalc' ? 'System' : `${a.by} · approved by ${a.approvedBy}`}</td><td className={`tnum ${td} text-right`}>{formatCurrency(a.amount)}</td></tr>)}</tbody></table>
      </Panel>}
      {s.statement && <Panel title="Bills in this statement" icon="receipt" count={s.statement.lines.length} flush>
        <table className="w-full border-collapse text-sm"><thead><tr>{['Invoice', 'Store', 'Rule', 'Net value'].map((h, i) => <th key={h} className={`${th} ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody>{s.statement.lines.map((l) => <tr key={l.voucher} className={tr}><td className={`${td} font-mono text-xs`}>{l.voucher}</td><td className={td}>{l.store}</td><td className={td}>{l.campaign ? `Campaign #${l.campaign}` : 'Standard'}{Number(l.share) !== 100 ? ` · ${l.share}% share` : ''}</td><td className={`tnum ${td} text-right`}>{formatCurrency(l.net)}</td></tr>)}</tbody></table>
      </Panel>}
      {collabs.some((c) => c.status === 'completed' || c.status === 'paid') && <p className="text-xs text-ink-muted">Collaborations: see <Link href="/partners/programs#collaborations" className="underline">Programs</Link>.</p>}
    </main>
  );
}
