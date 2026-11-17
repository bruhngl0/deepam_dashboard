/**
 * One partner: decide the application, then (once approved) their Partner ID, referral and dashboard links, level,
 * legal documents, details and every referral with its bills.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { PARTNER_CATEGORIES, PARTNER_DOCUMENTS } from '@/lib/partners/constants';
import { partnerDashboardBase, partnerLinkBase } from '@/lib/partners/links';
import { getPartner, getRules, listReferrals } from '@/lib/partners/queries';
import { refreshReferrals } from '@/lib/partners/store';
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPhone } from '@/lib/format';
import { button, card, control, eyebrow, primaryButton } from '@/components/ui';
import { WhatsAppShare } from '@/components/whatsapp-share';
import { approveAction, detailsAction, documentsAction, levelAction, rejectAction, rotateLinkAction, suspendAction } from '../actions';
import { ReferralTable } from '../referral-table';
import { Avatar, Callout, Icon, IconTile, Notices, Panel, PartnerBadge, Stat } from '../ui';

export const dynamic = 'force-dynamic';

const field = `${control} w-full`;

export default async function PartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const p = await getPartner(decodeURIComponent(id));
  if (!p) notFound();
  const [referrals, rules, linkBase, dashBase] = await Promise.all([listReferrals({ partnerId: p.id, limit: 1000 }), getRules(), partnerLinkBase(), partnerDashboardBase()]);
  const self = `/partners/${p.code ?? p.id}`;
  const hidden = <><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={self} /></>;
  const referralLink = p.code ? `${linkBase}/${p.code}` : null;
  const dashboardLink = p.dashboardToken ? `${dashBase}/${p.dashboardToken}` : null;
  const firstName = p.fullName.split(/\s+/)[0];
  const welcome = referralLink && dashboardLink
    ? `Hi ${firstName}, welcome to Deepam Partners!\n\nYour Deepam Partner ID: ${p.code}\nYour referral link (share it with your clients): ${referralLink}\nYour partner dashboard (keep this private): ${dashboardLink}\n\nA purchase counts when your client registers on your link and buys within ${rules.windowDays} days.`
    : '';
  const levelOptions = rules.levels.map((l) => <option key={l.level} value={l.level}>{l.name}{l.percent !== null ? ` · ${l.percent}%` : ' · % not set'}</option>);

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/partners/list" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-3 pl-2 text-xs font-medium text-ink-2 shadow-sm transition-colors hover:bg-inset hover:text-ink">
        <Icon name="back" className="size-3.5" />Partners
      </Link>
      <section className={`${card} flex flex-wrap items-center justify-between gap-5 p-5 sm:p-6`}>
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={p.fullName} size="xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{p.fullName}</h1>
              <PartnerBadge status={p.status} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
              <span className="inline-flex items-center gap-1.5"><Icon name="grid" className="size-3.5 text-ink-muted" />{p.category}</span>
              <span className="inline-flex items-center gap-1.5"><Icon name="map" className="size-3.5 text-ink-muted" />{p.city}</span>
              <span className="tnum inline-flex items-center gap-1.5"><Icon name="phone" className="size-3.5 text-ink-muted" />{formatPhone(p.phone)}</span>
              <span className="inline-flex min-w-0 items-center gap-1.5"><Icon name="mail" className="size-3.5 text-ink-muted" /><span className="truncate">{p.email}</span></span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="rounded-xl border border-line bg-inset/50 px-4 py-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">Partner ID</p>
            <p className="tnum text-lg font-semibold text-ink">{p.code ?? '—'}</p>
          </div>
          <div className="rounded-xl border border-line bg-inset/50 px-4 py-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">Level</p>
            <p className="text-lg font-semibold text-ink">{p.levelName}{p.levelPercent !== null && <span className="tnum ml-1 text-sm font-normal text-ink-2">{p.levelPercent}%</span>}</p>
          </div>
        </div>
      </section>
      <Notices sp={sp} />

      {(p.status === 'applied' || p.status === 'rejected') && (
        <Panel title={p.status === 'applied' ? 'Decide this application' : 'Rejected application'} icon="inbox" tone="wait">
          {p.status === 'rejected' && <p className="mb-3 text-sm text-ink-2">Rejected {p.decidedAt ? formatDate(p.decidedAt) : ''}{p.statusNote ? `: “${p.statusNote}”` : ''}. It can still be approved.</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <form action={approveAction} className="space-y-3 rounded-xl border border-emerald-600/25 bg-emerald-600/5 p-4">
              {hidden}
              <p className="flex gap-2 text-sm text-ink"><Icon name="check" className="mt-0.5 size-4 text-emerald-600" /><span><strong className="font-semibold">Approve</strong>: issues the Deepam Partner ID, the referral link and the partner dashboard. Collect the legal documents next.</span></p>
              <label className="block text-xs text-ink-muted">Commission level<select name="level" defaultValue={p.level} className={`${field} mt-1`}>{levelOptions}</select></label>
              <label className="block text-xs text-ink-muted">Note (optional)<input name="note" maxLength={500} className={`${field} mt-1`} /></label>
              <button type="submit" className={primaryButton}>Approve partner</button>
            </form>
            {p.status === 'applied' && (
              <form action={rejectAction} className="space-y-3 rounded-xl border border-line p-4">
                {hidden}
                <p className="text-sm text-ink"><strong className="font-semibold">Reject</strong>: no Partner ID is issued. The applicant is not told automatically.</p>
                <label className="block text-xs text-ink-muted">Reason<input name="note" maxLength={500} className={`${field} mt-1`} /></label>
                <button type="submit" className={button}>Reject application</button>
              </form>
            )}
          </div>
        </Panel>
      )}

      {(p.status === 'approved' || p.status === 'suspended') && referralLink && dashboardLink && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Partner ID and links" icon="link">
            <dl className="space-y-3 text-sm">
              <div className="rounded-xl bg-inset/50 px-3 py-2.5"><dt className={eyebrow}>Referral link (for customers)</dt><dd className="mt-0.5 break-all text-ink"><a href={referralLink} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">{referralLink}</a></dd></div>
              <div className="rounded-xl bg-inset/50 px-3 py-2.5"><dt className={eyebrow}>Partner dashboard (private to the partner)</dt><dd className="mt-0.5 break-all text-ink"><a href={dashboardLink} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">{dashboardLink}</a></dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <WhatsAppShare text={welcome} to={p.phone.replace(/\D/g, '')} label={`Send to ${firstName} on WhatsApp`} />
              <form action={rotateLinkAction}>{hidden}<button type="submit" className={button} title="Use if the dashboard link was shared by mistake">New dashboard link</button></form>
            </div>
            {p.status === 'suspended' && <Callout tone="bad" className="mt-3" title="Suspended">{p.statusNote ? `“${p.statusNote}”. ` : ''}The referral link does not accept registrations; the dashboard still opens.</Callout>}
          </Panel>

          <Panel title="Level and status" icon="sliders">
            <form action={levelAction} className="flex flex-wrap items-end gap-2">
              {hidden}
              <label className="text-xs text-ink-muted">Commission level<select name="level" defaultValue={p.level} className={`${control} mt-1 block`}>{levelOptions}</select></label>
              <button type="submit" className={button}>Change level</button>
            </form>
            <p className="mt-2 text-xs text-ink-muted">A bill takes the partner&rsquo;s level rate when it is validated; bills already validated keep theirs.</p>
            <div className="mt-4 border-t border-line pt-4">
              {p.status === 'approved' ? (
                <form action={suspendAction} className="flex flex-wrap items-end gap-2">
                  {hidden}
                  <label className="min-w-[14rem] flex-1 text-xs text-ink-muted">Reason<input name="note" maxLength={500} className={`${field} mt-1`} /></label>
                  <button type="submit" className={button}>Suspend partner</button>
                </form>
              ) : (
                <form action={approveAction} className="flex flex-wrap items-end gap-2">
                  {hidden}<input type="hidden" name="level" value={p.level} />
                  <button type="submit" className={primaryButton}>Reactivate partner</button>
                </form>
              )}
            </div>
          </Panel>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon="link" tone="info" label="Referred" value={formatNumber(p.referrals)} caption={`${formatNumber(p.registered)} inside the window · ${formatNumber(p.declined)} not accepted`} />
        <Stat icon="bag" tone="good" label="Purchased" value={formatNumber(p.converted)} caption={`${formatCurrency(p.salesValue)} in bills`} />
        <Stat icon="receipt" tone="wait" label="To validate" value={formatNumber(p.billsToValidate)} highlight={p.billsToValidate > 0} caption={p.levelPercent !== null ? `≈ ${formatCurrency(p.commissionPending)} at ${p.levelPercent}%` : `${p.levelName} has no commission % yet`} />
        <Stat icon="wallet" tone="good" label="Commission" value={formatCurrency(p.commissionValidated + p.commissionPaid)} caption={`${formatCurrency(p.commissionPaid)} paid · ${formatCurrency(p.commissionValidated)} to pay`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(p.status === 'approved' || p.status === 'suspended') && (
          <Panel title="Legal documents" icon="file" tone={p.documentsComplete ? 'good' : 'wait'} actions={<span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${p.documentsComplete ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>{p.documentsComplete ? 'All required received' : 'Required documents pending'}</span>}>
            <form action={documentsAction} className="space-y-2">
              {hidden}
              {PARTNER_DOCUMENTS.map((d) => (
                <label key={d.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink transition-colors hover:bg-inset/60">
                  <input type="checkbox" name="documents" value={d.key} defaultChecked={!!p.documents[d.key]} className="size-4 accent-accent" />
                  {d.label}
                  {p.documents[d.key] && <span className="tnum text-xs text-ink-muted">received {formatDate(p.documents[d.key])}</span>}
                </label>
              ))}
              <p className="text-xs text-ink-muted">Only that a document was received is kept here. Keep the documents themselves in the partner file.</p>
              <button type="submit" className={button}>Save documents</button>
            </form>
          </Panel>
        )}

        <Panel title="Details" icon="user">
          <dl className="mb-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className={eyebrow}>Contact number</dt><dd className="tnum mt-0.5 text-ink">{formatPhone(p.phone)}</dd></div>
            <div><dt className={eyebrow}>Applied</dt><dd className="mt-0.5 text-ink">{formatDateTime(p.appliedAt)} · agreed to the terms</dd></div>
            {p.approvedAt && <div><dt className={eyebrow}>Approved</dt><dd className="mt-0.5 text-ink">{formatDate(p.approvedAt)}</dd></div>}
          </dl>
          <form action={detailsAction} className="grid gap-3 sm:grid-cols-2">
            {hidden}
            <label className="text-xs text-ink-muted">Full name<input name="fullName" required maxLength={120} defaultValue={p.fullName} className={`${field} mt-1`} /></label>
            <label className="text-xs text-ink-muted">Email<input name="email" type="email" required maxLength={160} defaultValue={p.email} className={`${field} mt-1`} /></label>
            <label className="text-xs text-ink-muted">Category<select name="category" defaultValue={p.category} className={`${field} mt-1`}>{PARTNER_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="text-xs text-ink-muted">City<input name="city" required maxLength={80} defaultValue={p.city} className={`${field} mt-1`} /></label>
            <label className="text-xs text-ink-muted sm:col-span-2">Notes<textarea name="notes" rows={2} maxLength={2000} defaultValue={p.notes ?? ''} className={`${field} mt-1`} /></label>
            <div className="sm:col-span-2"><button type="submit" className={button}>Save details</button></div>
          </form>
          <p className="mt-2 text-xs text-ink-muted">The contact number is the partner&rsquo;s identity and is not edited here.</p>
        </Panel>
      </div>

      <h2 className="flex items-center gap-2.5 pt-2 text-base font-semibold tracking-tight text-ink"><IconTile name="link" tone="info" size="sm" />Referrals<span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-inset px-1.5 text-xs font-semibold text-ink-2">{referrals.length}</span></h2>
      <ReferralTable referrals={referrals} back={self} showPartner={false} empty={p.code ? 'No one has registered on this partner’s link yet.' : 'Referrals start once the partner is approved.'} />
    </main>
  );
}
