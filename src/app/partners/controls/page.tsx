/**
 * Attribution and fraud controls (program rules §§10, 16–18): bills claimed by more than one party, retrospective
 * attribution, fraud flags and manual adjustments. Anything open here holds the bill: it earns nothing and its
 * month's statement cannot be verified until it is decided. Every decision records who made it and why.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { monthLabel } from '@/lib/partners/constants';
import { activePartners, adjustments, claims, flags } from '@/lib/partners/program-queries';
import { CLAIMANT_LABEL, FLAG_LABEL } from '@/lib/partners/program';
import { refreshReferrals } from '@/lib/partners/store';
import { formatCurrency, formatDate } from '@/lib/format';
import { button, control, primaryButton } from '@/components/ui';
import { adjustmentAction, claimAction, flagAction, retroAction } from '../program-actions';
import { ByField, Empty, Notices, Panel, PartnerHeader, Pill, Stat, td, th, tr, Who } from '../ui';

export const dynamic = 'force-dynamic';
const back = '/partners/controls';
const Hidden = ({ values }: { values: Record<string, string | number> }) => <>{Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}<input type="hidden" name="back" value={back} /></>;

export default async function ControlsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  const [allClaims, allFlags, pendingAdj, recentAdj, partners] = await Promise.all([claims(), flags(), adjustments({ unapproved: true }), adjustments(), activePartners()]);
  const openClaims = allClaims.filter((c) => c.status === 'open'), openFlags = allFlags.filter((f) => f.status === 'open');
  const partnerOptions = partners.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.partner_code}</option>);

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="alert" eyebrow="Ananta Partner Network" title="Controls" description="One beneficiary per bill. Claims, flags and retrospective requests hold the bill until someone decides; nothing is paid on a held bill." />
      <Notices sp={sp} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon="users" tone={openClaims.length ? 'wait' : 'good'} label="Open claims" value={String(openClaims.length)} caption="bills claimed by more than one party" />
        <Stat icon="alert" tone={openFlags.length ? 'bad' : 'good'} label="Open flags" value={String(openFlags.length)} caption="possible fraud or requests to review" />
        <Stat icon="sliders" tone={pendingAdj.length ? 'wait' : 'good'} label="Adjustments to approve" value={String(pendingAdj.length)} caption="manual corrections" />
      </div>

      <Panel title="Flags" description="Raised automatically (self referral, duplicate registrations, repeated returns, unusually large bills, personal purchases matched to referrals, unusual adjustments, possible duplicate payouts) or by staff. Clear to let the bill count; confirm to exclude it." icon="alert" tone="bad" count={openFlags.length} flush>
        <div className="overflow-x-auto"><table className="w-full border-collapse text-sm" style={{ minWidth: '60rem' }}>
          <thead><tr>{['Flag', 'Partner', 'Invoice', 'Detail', 'Decision'].map((h) => <th key={h} className={`${th} text-left`}>{h}</th>)}</tr></thead>
          <tbody>
            {allFlags.length === 0 && <tr><td colSpan={5}><Empty icon="check">No flags.</Empty></td></tr>}
            {allFlags.slice(0, 60).map((f) => (
              <tr key={f.id} className={tr}>
                <td className={td}><Pill tone={f.status === 'open' ? 'bad' : f.status === 'cleared' ? 'good' : 'quiet'}>{FLAG_LABEL[f.kind] ?? f.kind}</Pill><span className="mt-1 block text-xs text-ink-muted">{formatDate(f.at)} · {f.by}</span></td>
                <td className={td}>{f.partnerName ? <Who name={f.partnerName} sub={f.partnerCode ?? ''} href={`/partners/${f.partnerCode ?? f.partnerId}`} /> : '—'}</td>
                <td className={`${td} font-mono text-xs`}>{f.voucher ?? '—'}</td>
                <td className={`${td} max-w-md text-ink-2`}>{f.detail}</td>
                <td className={td}>{f.status === 'open' ? (
                  <form action={flagAction} className="flex flex-wrap gap-1"><Hidden values={{ id: f.id }} />
                    <input name="reason" required placeholder="Reason" aria-label="Reason" className={`${control} w-36 py-1`} /><ByField className="w-28" />
                    <button name="do" value="cleared" className={button}>{f.kind === 'retro_attribution' ? 'Approve' : 'Clear'}</button>
                    <button name="do" value="confirmed" className={button}>{f.kind === 'retro_attribution' ? 'Refuse' : 'Confirm fraud'}</button>
                  </form>) : <span className="text-xs text-ink-muted">{f.status === 'cleared' ? 'Cleared' : 'Confirmed'} by {f.resolvedBy}: {f.resolvedReason}</span>}</td>
              </tr>))}
          </tbody></table></div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Claims on a bill" description="A driver, travel agent, affiliate or another partner says the sale was theirs. Decide: the partner keeps it, the other party gets it, or it is shared (the partner's % of the commission)." icon="users" count={openClaims.length}>
          <div className="space-y-4">
            {allClaims.length === 0 && <p className="text-sm text-ink-muted">No claims.</p>}
            {allClaims.slice(0, 40).map((c) => (
              <div key={c.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs">{c.voucher}{c.billAmount !== null && <span className="ml-2 font-sans text-ink-2">{formatCurrency(c.billAmount)}</span>}</span>
                  <Pill tone={c.status === 'open' ? 'wait' : 'quiet'}>{c.status === 'open' ? 'Open: bill on hold' : `Decided: ${c.resolution === 'partner' ? 'partner keeps it' : c.resolution === 'other' ? 'other party' : `shared, partner ${c.share}%`}`}</Pill>
                </div>
                <p className="mt-1 text-ink-2">{CLAIMANT_LABEL[c.claimantType as keyof typeof CLAIMANT_LABEL] ?? c.claimantType} <b>{c.claimantName}</b> vs partner {c.partnerName ? `${c.partnerName} (${c.partnerCode})` : '— (not attributed)'}{c.note ? ` · ${c.note}` : ''}</p>
                {c.status === 'open' ? (
                  <form action={claimAction} className="mt-2 flex flex-wrap gap-1"><Hidden values={{ id: c.id, do: 'resolve' }} />
                    <select name="resolution" required className={`${control} py-1`} aria-label="Decision"><option value="partner">Partner keeps it</option><option value="other">Other party gets it</option><option value="shared">Shared</option></select>
                    <input name="share" type="number" min={1} max={99} placeholder="Partner %" aria-label="Partner share %" className={`${control} w-24 py-1`} />
                    <input name="reason" required placeholder="Reason" aria-label="Reason" className={`${control} w-36 py-1`} /><ByField className="w-28" />
                    <button className={primaryButton}>Decide</button>
                  </form>) : <p className="mt-1 text-xs text-ink-muted">{c.resolvedBy}: {c.resolvedReason}</p>}
              </div>))}
            <form action={claimAction} className="grid gap-2 rounded-xl border border-dashed border-line p-3 sm:grid-cols-2"><Hidden values={{ do: 'add' }} />
              <p className="text-sm font-medium text-ink sm:col-span-2">Record a claim</p>
              <input name="voucher" required placeholder="Invoice (e.g. BK01-01941)" aria-label="Invoice" className={control} />
              <select name="type" required aria-label="Who is claiming" className={control}>{Object.entries(CLAIMANT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input name="name" required placeholder="Claimant's name" aria-label="Claimant's name" className={control} />
              <input name="note" placeholder="Note" aria-label="Note" className={control} />
              <ByField className="w-full" /><button className={primaryButton}>Record claim</button>
            </form>
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel title="Retrospective attribution" description="A bill the matching did not attach (bought before the referral was entered, or just outside the window). Requested with a reason; approved on Flags by someone else. A bill already attributed cannot be moved (use a claim)." icon="link">
            <form action={retroAction} className="grid gap-2 sm:grid-cols-2"><Hidden values={{}} />
              <input name="voucher" required placeholder="Invoice" aria-label="Invoice" className={control} />
              <input name="partner" required placeholder="Partner ID (APR-00001)" aria-label="Partner ID" className={control} />
              <input name="reason" required placeholder="Why it should count" aria-label="Reason" className={`${control} sm:col-span-2`} />
              <ByField className="w-full" /><button className={primaryButton}>Request</button>
            </form>
          </Panel>
          <Panel title="Raise a flag" icon="alert">
            <form action={flagAction} className="grid gap-2 sm:grid-cols-2"><Hidden values={{ do: 'raise' }} />
              <select name="partner" required aria-label="Partner" className={control}><option value="">Partner…</option>{partnerOptions}</select>
              <input name="voucher" placeholder="Invoice (optional: holds that bill)" aria-label="Invoice" className={control} />
              <input name="detail" required placeholder="What looks wrong" aria-label="Detail" className={`${control} sm:col-span-2`} />
              <ByField className="w-full" /><button className={primaryButton}>Raise flag</button>
            </form>
          </Panel>
          <Panel title="Manual adjustments" description="A correction either way (negative recovers an amount), on the partner's next statement once someone other than who entered it approves. Settled statements are never edited." icon="sliders" count={pendingAdj.length}>
            <div className="space-y-2">
              {pendingAdj.map((a) => (
                <form key={a.id} action={adjustmentAction} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2 text-sm"><Hidden values={{ id: a.id, do: 'approve' }} />
                  <span className="flex-1">{a.partnerName} · {formatCurrency(a.amount)} · {a.reason} <span className="text-xs text-ink-muted">({a.by})</span></span>
                  <ByField className="w-28" /><button className={primaryButton}>Approve</button>
                </form>))}
              <form action={adjustmentAction} className="grid gap-2 sm:grid-cols-2"><Hidden values={{ do: 'add' }} />
                <select name="partner" required aria-label="Partner" className={control}><option value="">Partner…</option>{partnerOptions}</select>
                <input name="month" type="month" aria-label="For month" className={control} />
                <input name="amount" type="number" step="0.01" required placeholder="Amount (− to recover)" aria-label="Amount" className={control} />
                <input name="reason" required placeholder="Reason" aria-label="Reason" className={control} />
                <ByField className="w-full" /><button className={primaryButton}>Enter adjustment</button>
              </form>
              {recentAdj.length > 0 && <ul className="mt-2 space-y-1 text-xs text-ink-muted">{recentAdj.slice(0, 12).map((a) => <li key={a.id}>{a.partnerName}: {formatCurrency(a.amount)} for {monthLabel(a.month)} · {a.kind === 'recalc' ? 'recalculated' : 'manual'}{a.appliedTo ? ` · on the ${monthLabel(a.appliedTo)} statement` : ' · next statement'}</li>)}</ul>}
            </div>
          </Panel>
        </div>
      </div>
      <p className="text-xs text-ink-muted">Bills to validate are on <Link href="/partners/referrals" className="underline">Referrals</Link>.</p>
    </main>
  );
}
