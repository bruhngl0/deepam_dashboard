/**
 * Programs on top of the standard commission (program rules §§7–9, 11, 15): campaigns, commission exclusions,
 * influencer collaborations, additional incentives, personal shopping, and which entity each store's sales belong to.
 * Campaigns and incentives start as drafts and are switched on by a second person.
 *
 * Personal shopping is billed in the ERP; it is recorded here with its invoice (staff confirm the OTP was checked at
 * billing) so the annual limit and the discount at the partner's level are tracked, and the bill never earns commission.
 */

import { requireUser } from '@/lib/auth';
import { REFERRAL_STORES } from '@/lib/partners/constants';
import { activePartners, campaigns, collaborations, exclusions, incentives, personalPurchases } from '@/lib/partners/program-queries';
import { collaborationLimit, entities, INCENTIVE_KIND_LABEL, shoppingAllowance } from '@/lib/partners/program';
import { categories, rulesFor } from '@/lib/partners/rules';
import { refreshReferrals } from '@/lib/partners/store';
import { formatCurrency, formatDate } from '@/lib/format';
import { button, control, primaryButton } from '@/components/ui';
import { campaignAction, collaborationAction, entityAction, exclusionAction, incentiveAction, personalPurchaseAction } from '../program-actions';
import { ByField, Empty, Notices, Panel, PartnerHeader, Pill, td, th, tr, Who } from '../ui';

export const dynamic = 'force-dynamic';
const back = '/partners/programs';
const Hidden = ({ values }: { values: Record<string, string | number> }) => <>{Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}<input type="hidden" name="back" value={back} /></>;
const STATUS_TONE = { draft: 'wait', active: 'good', ended: 'quiet', pending: 'wait', approved: 'info', rejected: 'quiet', completed: 'good', paid: 'good' } as const;
const field = `${control} w-full`;

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  const [camps, excl, collabs, incs, purchases, partners, ents, cats, rules] = await Promise.all([
    campaigns(), exclusions(), collaborations(), incentives(), personalPurchases(), activePartners(), entities(), categories(), rulesFor()]);
  const limits = new Map(await Promise.all([...new Set(collabs.filter((c) => c.status === 'pending').map((c) => c.partnerId))].map(async (id) => [id, await collaborationLimit(id)] as const)));
  const allowances = new Map(await Promise.all([...new Set(purchases.map((p) => p.partnerId))].map(async (id) => [id, await shoppingAllowance(id)] as const)));
  const entityNames = [...new Set(['Deepam by Ananta', ...ents.map((e) => e.entity)])];
  const partnerOptions = partners.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.partner_code}</option>);

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="trophy" eyebrow="Ananta Partner Network" title="Programs" description="Campaigns, exclusions, collaborations, incentives and personal shopping. Each is recorded with who set it up and who approved it." />
      <Notices sp={sp} />

      <Panel title="Campaigns" description="A campaign's commission % replaces the standard rate on bills in its dates and stores (no stores = all). Where two cover a bill, the lower priority number wins. Settled months never change." icon="trophy" count={camps.length} flush>
        <div className="overflow-x-auto"><table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
          <thead><tr>{['Campaign', 'Dates', 'Stores', 'Rate', 'Counts towards', 'Bills', 'Sales', 'Commission', ''].map((h, i) => <th key={h || i} className={`${th} ${i >= 5 && i <= 7 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody>
            {camps.length === 0 && <tr><td colSpan={9}><Empty icon="trophy">No campaigns yet.</Empty></td></tr>}
            {camps.map((c) => (
              <tr key={c.id} className={tr}>
                <td className={td}><span className="font-medium text-ink">{c.name}</span> <Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill><span className="block text-xs text-ink-muted">#{c.id} · priority {c.priority} · {c.by}{c.approvedBy ? `, approved by ${c.approvedBy}` : ''}{c.excludedInvoices.length ? ` · ${c.excludedInvoices.length} invoices excluded` : ''}</span></td>
                <td className={td}>{formatDate(c.startsOn)} – {formatDate(c.endsOn)}</td>
                <td className={td}>{c.storeCodes.length ? c.storeCodes.join(', ') : 'All'}</td>
                <td className={`tnum ${td}`}>{c.percent}%</td>
                <td className={`${td} text-xs`}>{[c.countsTowardLevel && 'slab & level', c.bonusEligible && 'bonus', c.personalDiscountAllowed && 'personal discount allowed'].filter(Boolean).join(' · ') || 'nothing else'}</td>
                <td className={`tnum ${td} text-right`}>{c.bills}</td><td className={`tnum ${td} text-right`}>{formatCurrency(c.sales)}</td><td className={`tnum ${td} text-right`}>{formatCurrency(c.commission)}</td>
                <td className={td}>{c.status !== 'ended' && <form action={campaignAction} className="flex gap-1"><Hidden values={{ id: c.id }} /><ByField className="w-28" />
                  {c.status === 'draft' && <button name="do" value="active" className={primaryButton}>Activate</button>}<button name="do" value="ended" className={button}>End</button></form>}</td>
              </tr>))}
          </tbody></table></div>
        <form action={campaignAction} className="grid gap-3 border-t border-grid p-5 sm:grid-cols-2 lg:grid-cols-4"><Hidden values={{ do: 'create' }} />
          <label className="text-sm text-ink lg:col-span-2">Name<input name="name" required maxLength={120} className={`${field} mt-1`} /></label>
          <label className="text-sm text-ink">Starts<input name="startsOn" type="date" required className={`${field} mt-1`} /></label>
          <label className="text-sm text-ink">Ends<input name="endsOn" type="date" required className={`${field} mt-1`} /></label>
          <label className="text-sm text-ink">Commission %<input name="percent" type="number" step="0.01" min={0} max={100} required className={`${field} mt-1`} /></label>
          <label className="text-sm text-ink">Priority<input name="priority" type="number" defaultValue={100} className={`${field} mt-1`} /></label>
          <label className="text-sm text-ink">Min. margin % (recorded)<input name="margin" type="number" step="0.01" className={`${field} mt-1`} /></label>
          <fieldset className="text-sm text-ink"><legend>Stores (none = all)</legend><div className="mt-2 flex gap-3">{REFERRAL_STORES.map((s) => <label key={s.code} className="flex items-center gap-1"><input type="checkbox" name="stores" value={s.code} />{s.label}</label>)}</div></fieldset>
          <label className="text-sm text-ink lg:col-span-2">Invoices excluded from it<input name="excluded" placeholder="BK01-01941, BK02-00012" className={`${field} mt-1`} /></label>
          <fieldset className="flex flex-wrap items-end gap-4 text-sm text-ink lg:col-span-2">
            <label className="flex items-center gap-1"><input type="checkbox" name="counts" defaultChecked />Counts towards slab &amp; level</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="bonus" defaultChecked />Counts towards bonus</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="personal" />Personal discount allowed</label>
          </fieldset>
          <label className="text-sm text-ink lg:col-span-3">Notes (brands, categories, profitability)<input name="notes" className={`${field} mt-1`} /></label>
          <div className="flex items-end gap-2"><ByField className="w-full" /><button className={primaryButton}>Save draft</button></div>
        </form>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Exclusions" description="Bills that earn no commission: a store for a period, or single invoices. Announce before the sale." icon="filter" count={excl.length}>
          <ul className="space-y-2 text-sm">
            {excl.map((e) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-2">
              <span><b>{e.scope === 'store' ? 'Store' : 'Invoice'} {e.value}</b> · {formatDate(e.fromOn)}{e.toOn ? ` – ${formatDate(e.toOn)}` : ' onwards'} · {e.reason} <span className="text-xs text-ink-muted">({e.by})</span></span>
              {!e.toOn && <form action={exclusionAction}><Hidden values={{ id: e.id, do: 'end' }} /><button className={button}>End</button></form>}
            </li>)}
          </ul>
          <form action={exclusionAction} className="mt-3 grid gap-2 sm:grid-cols-3"><Hidden values={{ do: 'add' }} />
            <select name="scope" aria-label="Scope" className={control}><option value="invoice">Invoice</option><option value="store">Store</option></select>
            <input name="value" required placeholder="BK01-01941 or MG_ROAD" aria-label="Invoice or store code" className={control} />
            <input name="from" type="date" required aria-label="From" className={control} />
            <input name="to" type="date" aria-label="To (optional)" className={control} />
            <input name="reason" required placeholder="Reason" aria-label="Reason" className={control} />
            <div className="flex gap-2"><ByField className="w-full" /><button className={primaryButton}>Add</button></div>
          </form>
        </Panel>

        <Panel title="Personal shopping" description={`A partner's own purchases at their level's discount, up to ₹${rules.terms.annualShoppingLimit.toLocaleString('en-IN')} a calendar year before discount and GST, across all stores. Returns give the limit back. These bills never earn commission.`} icon="bag" count={purchases.length}>
          <form action={personalPurchaseAction} className="grid gap-2 sm:grid-cols-3"><Hidden values={{}} />
            <select name="partner" required aria-label="Partner" className={`${control} sm:col-span-2`}><option value="">Partner…</option>{partnerOptions}</select>
            <input name="voucher" required placeholder="Invoice" aria-label="Invoice" className={control} />
            <input name="purchaseOn" type="date" aria-label="Purchase date" className={control} />
            <input name="value" type="number" step="0.01" min="0.01" required placeholder="Value before discount, ex-GST" aria-label="Value" className={control} />
            <input name="note" placeholder="Note" aria-label="Note" className={control} />
            <label className="flex items-center gap-1 text-sm text-ink sm:col-span-2"><input type="checkbox" name="otp" required />OTP verified at billing</label>
            <div className="flex gap-2"><ByField className="w-full" /><button className={primaryButton}>Record</button></div>
          </form>
          <ul className="mt-3 space-y-1 text-sm">{purchases.slice(0, 20).map((p) => {
            const a = allowances.get(p.partnerId);
            return <li key={p.id} className="flex justify-between gap-2 border-t border-grid pt-1"><span>{p.partnerName} · <span className="font-mono text-xs">{p.voucher}</span> · {formatDate(p.purchaseOn)}{p.returned ? ' · returned' : ''}</span>
              <span className="tnum text-right">{p.percent}% on {formatCurrency(p.eligible)} = {formatCurrency(p.discount)}{a && <span className="block text-xs text-ink-muted">{formatCurrency(a.left)} left in {a.year}</span>}</span></li>;
          })}</ul>
        </Panel>
      </div>

      <Panel title="Influencer collaborations" description="Approved by management before the work starts, within the limit of the partner's previous completed month's commission level (an exception needs a reason). Payable once the deliverables are complete, on that month's statement, charged to the approving brand." icon="share" count={collabs.length} flush>
        <span id="collaborations" />
        <div className="overflow-x-auto"><table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
          <thead><tr>{['Partner', 'Collaboration', 'Brand', 'Due', 'Fee', 'Status', ''].map((h, i) => <th key={h || i} className={`${th} ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody>
            {collabs.length === 0 && <tr><td colSpan={7}><Empty icon="share">No collaborations yet.</Empty></td></tr>}
            {collabs.map((c) => {
              const lim = limits.get(c.partnerId);
              return <tr key={c.id} className={tr}>
                <td className={td}><Who name={c.partnerName} sub={c.partnerCode ?? ''} /></td>
                <td className={td}><span className="font-medium text-ink">{c.title}</span><span className="block text-xs text-ink-muted">{c.deliverables}</span></td>
                <td className={td}>{c.entity}</td><td className={td}>{formatDate(c.dueOn)}</td>
                <td className={`tnum ${td} text-right`}>{formatCurrency(c.amount)}{lim && c.status === 'pending' && <span className={`block text-xs ${c.amount > lim.left ? 'text-amber-700 dark:text-amber-300' : 'text-ink-muted'}`}>L{lim.level} limit {formatCurrency(lim.limit)}, {formatCurrency(lim.left)} left</span>}</td>
                <td className={td}><Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill>{c.exception && <span className="block text-xs text-ink-muted">Exception: {c.exception}</span>}{c.rejectedReason && <span className="block text-xs text-ink-muted">{c.rejectedReason}</span>}</td>
                <td className={td}>
                  {c.status === 'pending' && <form action={collaborationAction} className="flex flex-wrap gap-1"><Hidden values={{ id: c.id }} /><input name="reason" placeholder="Reason / exception" aria-label="Reason" className={`${control} w-36 py-1`} /><ByField className="w-28" /><button name="do" value="approve" className={primaryButton}>Approve</button><button name="do" value="reject" className={button}>Reject</button></form>}
                  {c.status === 'approved' && <form action={collaborationAction} className="flex gap-1"><Hidden values={{ id: c.id, do: 'complete' }} /><ByField className="w-28" /><button className={primaryButton}>Deliverables done</button></form>}
                </td>
              </tr>;
            })}
          </tbody></table></div>
        <form action={collaborationAction} className="grid gap-2 border-t border-grid p-5 sm:grid-cols-3 lg:grid-cols-6"><Hidden values={{ do: 'request' }} />
          <select name="partner" required aria-label="Partner" className={control}><option value="">Partner…</option>{partnerOptions}</select>
          <input name="title" required placeholder="Collaboration" aria-label="Collaboration" className={control} />
          <input name="deliverables" required placeholder="Deliverables (2 reels, 1 story…)" aria-label="Deliverables" className={control} />
          <select name="entity" required aria-label="Approving brand" className={control}>{entityNames.map((e) => <option key={e}>{e}</option>)}</select>
          <input name="dueOn" type="date" required aria-label="Due" className={control} />
          <input name="amount" type="number" step="0.01" min="1" required placeholder="Fee ₹" aria-label="Fee" className={control} />
          <div className="flex gap-2 lg:col-span-2"><ByField className="w-full" /><button className={primaryButton}>Request</button></div>
        </form>
      </Panel>

      <Panel title="Additional incentives" description="Off until a second person activates them. Automatic awards are worked out for each completed month in the incentive's dates (a return before settlement can take one away); a total cap stops awards once reached." icon="rupee" count={incs.length} flush>
        <div className="overflow-x-auto"><table className="w-full border-collapse text-sm" style={{ minWidth: '60rem' }}>
          <thead><tr>{['Incentive', 'Rule', 'Dates', 'Reward', 'Awarded', ''].map((h, i) => <th key={h || i} className={`${th} ${i === 3 || i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody>
            {incs.length === 0 && <tr><td colSpan={6}><Empty icon="rupee">No incentives yet.</Empty></td></tr>}
            {incs.map((i) => <tr key={i.id} className={tr}>
              <td className={td}><span className="font-medium text-ink">{i.name}</span> <Pill tone={STATUS_TONE[i.status]}>{i.status}</Pill><span className="block text-xs text-ink-muted">{i.by}{i.approvedBy ? `, activated by ${i.approvedBy}` : ''}{i.entity ? ` · ${i.entity}` : ''}</span></td>
              <td className={`${td} text-xs`}>{INCENTIVE_KIND_LABEL[i.kind as keyof typeof INCENTIVE_KIND_LABEL]}{i.minSales ? ` · ${formatCurrency(i.minSales)}+` : ''}{i.kind === 'consistency' ? ` · ${i.months} months` : ''}{i.categories.length ? ` · ${i.categories.join(', ')}` : ''}{i.levels.length ? ` · levels ${i.levels.join(', ')}` : ''}</td>
              <td className={td}>{formatDate(i.startsOn)} – {formatDate(i.endsOn)}</td>
              <td className={`tnum ${td} text-right`}>{formatCurrency(i.reward)}{i.maxPayout && <span className="block text-xs text-ink-muted">cap {formatCurrency(i.maxPayout)}</span>}</td>
              <td className={`tnum ${td} text-right`}>{formatCurrency(i.awarded)}<span className="block text-xs text-ink-muted">{i.awards} awards</span></td>
              <td className={td}>{i.status !== 'ended' && <div className="space-y-1">
                <form action={incentiveAction} className="flex gap-1"><Hidden values={{ id: i.id }} /><ByField className="w-28" />{i.status === 'draft' && <button name="do" value="active" className={primaryButton}>Activate</button>}<button name="do" value="ended" className={button}>End</button></form>
                {i.status === 'active' && i.kind === 'manual' && <form action={incentiveAction} className="flex gap-1"><Hidden values={{ id: i.id, do: 'award' }} /><select name="partner" required aria-label="Partner" className={`${control} w-40 py-1`}>{partnerOptions}</select><input name="month" type="month" aria-label="Month" className={`${control} py-1`} /><ByField className="w-28" /><button className={primaryButton}>Award</button></form>}
              </div>}</td>
            </tr>)}
          </tbody></table></div>
        <form action={incentiveAction} className="grid gap-2 border-t border-grid p-5 sm:grid-cols-3 lg:grid-cols-6"><Hidden values={{ do: 'create' }} />
          <input name="name" required placeholder="Name" aria-label="Name" className={control} />
          <select name="kind" aria-label="Kind" className={control}>{Object.entries(INCENTIVE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input name="minSales" type="number" min={0} placeholder="Min. monthly sales ₹" aria-label="Minimum monthly sales" className={control} />
          <input name="months" type="number" min={1} max={12} defaultValue={3} aria-label="Months in a row" title="Months in a row (consistency)" className={control} />
          <input name="reward" type="number" step="0.01" min="1" required placeholder="Reward ₹" aria-label="Reward" className={control} />
          <input name="maxPayout" type="number" step="0.01" placeholder="Total cap ₹ (optional)" aria-label="Total cap" className={control} />
          <input name="startsOn" type="date" required aria-label="Starts" className={control} />
          <input name="endsOn" type="date" required aria-label="Ends" className={control} />
          <select name="entity" aria-label="Charged to" className={control}><option value="">Charged by sales</option>{entityNames.map((e) => <option key={e}>{e}</option>)}</select>
          <select name="categories" multiple aria-label="Partner categories (none = all)" className={`${control} h-20`}>{cats.map((c) => <option key={c.name}>{c.name}</option>)}</select>
          <select name="levels" multiple aria-label="Levels (none = all)" className={`${control} h-20`}>{[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Level {l}</option>)}</select>
          <div className="flex items-end gap-2"><ByField className="w-full" /><button className={primaryButton}>Save draft</button></div>
        </form>
      </Panel>

      <Panel title="Entities" description="Which legal entity each store's sales belong to: commission is charged where the sale was made." icon="grid">
        <div className="grid gap-2 sm:grid-cols-2">{REFERRAL_STORES.map((s) => (
          <form key={s.code} action={entityAction} className="flex items-center gap-2"><Hidden values={{ store: s.code }} />
            <span className="w-28 text-sm text-ink">{s.label}</span><input name="entity" required defaultValue={ents.find((e) => e.store_code === s.code)?.entity ?? 'Deepam by Ananta'} aria-label={`Entity for ${s.label}`} className={`${control} flex-1`} />
            <button className={button}>Save</button></form>))}</div>
      </Panel>
    </main>
  );
}
