/** Every partner and applicant, awaiting a decision first. Filter by status, category or a search. */

import { requireUser } from '@/lib/auth';
import { PARTNER_CATEGORIES, PARTNER_STATUSES } from '@/lib/partners/constants';
import { listPartners } from '@/lib/partners/queries';
import { pickRange, pickStores, rangeLabel } from '@/lib/module-filters';
import { refreshReferrals } from '@/lib/partners/store';
import { formatCurrency, formatDate, formatNumber, formatPhone } from '@/lib/format';
import { button, card } from '@/components/ui';
import { Empty, Icon, Notices, one, PartnerBadge, PartnerHeader, td, th, tr, Who } from '../ui';

export const dynamic = 'force-dynamic';

export default async function PartnerListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  const status = PARTNER_STATUSES.find((s) => s === one(sp.status)) ?? '';
  const category = PARTNER_CATEGORIES.find((c) => c === one(sp.category)) ?? '';
  const search = one(sp.q).slice(0, 80);
  const { from, to } = pickRange(sp, { from: null, to: null });
  const stores = pickStores(sp);
  const partners = await listPartners({ status, category, search, from, to, stores });
  const filtered = !!(status || category || search || from || to || stores);

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PartnerHeader icon="users" eyebrow="Ananta Partner Network" title="Partners" description="Applications from the public form and every approved partner. Open one to approve it, collect documents and send the links."
        meta={`${formatNumber(partners.length)} ${filtered ? 'matching' : 'in all'}${from || to ? ` · applied ${rangeLabel(from, to)}` : ''}`} actions={<a href="/deepampartner" target="_blank" rel="noreferrer" className={button}><Icon name="plus" />Add an application</a>} />
      <Notices sp={sp} />


      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
            <thead><tr>
              {['Partner', 'Category', 'City', 'Contact', 'Status', 'Level', 'Referred', 'Purchased', 'Bills', 'Applied'].map((h, i) =>
                <th key={h} scope="col" className={`${th} ${i >= 6 && i <= 8 ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {partners.length === 0 && <tr><td colSpan={10}><Empty icon="users">{filtered ? 'No partner matches these filters.' : 'No applications yet.'}</Empty></td></tr>}
              {partners.map((p) => (
                <tr key={p.id} className={tr}>
                  <th scope="row" className={`${td} text-left font-normal`}>
                    <Who name={p.fullName} sub={p.code ?? 'No Partner ID yet'} href={`/partners/${p.code ?? p.id}`} />
                  </th>
                  <td className={`${td} text-ink-2`}>{p.category}</td>
                  <td className={`${td} text-ink-2`}>{p.city}</td>
                  <td className={`${td} text-ink-2`}><span className="tnum">{formatPhone(p.phone)}</span><span className="block text-xs text-ink-muted">{p.email}</span></td>
                  <td className={td}><PartnerBadge status={p.status} />{p.status === 'approved' && !p.documentsComplete && <span className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><Icon name="file" className="size-3.5" />Documents pending</span>}</td>
                  <td className={`${td} text-ink-2`}>{p.levelName}</td>
                  <td className={`tnum ${td} text-right`}>{formatNumber(p.referrals)}</td>
                  <td className={`tnum ${td} text-right`}>{formatNumber(p.converted)}</td>
                  <td className={`tnum ${td} text-right`}>{formatCurrency(p.salesValue)}</td>
                  <td className={`tnum ${td} text-ink-2`}>{formatDate(p.appliedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
