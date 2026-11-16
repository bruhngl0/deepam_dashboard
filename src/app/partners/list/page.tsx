/** Every partner and applicant, awaiting a decision first. Filter by status, category or a search. */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { PARTNER_CATEGORIES, PARTNER_STATUS_LABEL, PARTNER_STATUSES } from '@/lib/partners/constants';
import { listPartners } from '@/lib/partners/queries';
import { refreshReferrals } from '@/lib/partners/store';
import { formatCurrency, formatDate, formatNumber, formatPhone } from '@/lib/format';
import { button, card, control, eyebrow, FilterField, FilterRow, PageHeader, textButton } from '@/components/ui';
import { Notices, one, PartnerBadge, td, th } from '../ui';

export const dynamic = 'force-dynamic';

export default async function PartnerListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  await refreshReferrals();
  const sp = await searchParams;
  const status = PARTNER_STATUSES.find((s) => s === one(sp.status)) ?? '';
  const category = PARTNER_CATEGORIES.find((c) => c === one(sp.category)) ?? '';
  const search = one(sp.q).slice(0, 80);
  const partners = await listPartners({ status, category, search });
  const filtered = !!(status || category || search);

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow="Partner Network" title="Partners" description="Applications from the public form and every approved partner. Open one to approve it, collect documents and send the links."
        meta={`${formatNumber(partners.length)} ${filtered ? 'matching' : 'in all'}`} actions={<a href="/deepampartner" target="_blank" rel="noreferrer" className={button}>Add an application</a>} />
      <Notices sp={sp} />

      <form method="get">
        <FilterRow>
          <FilterField label="Status">
            <select name="status" defaultValue={status} className={control}>
              <option value="">All</option>
              {PARTNER_STATUSES.map((s) => <option key={s} value={s}>{PARTNER_STATUS_LABEL[s]}</option>)}
            </select>
          </FilterField>
          <FilterField label="Category">
            <select name="category" defaultValue={category} className={control}>
              <option value="">All</option>
              {PARTNER_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </FilterField>
          <input type="search" name="q" defaultValue={search} placeholder="Name, Partner ID, phone, email, city" className={`${control} w-64`} aria-label="Search partners" />
          <button type="submit" className={button}>Apply</button>
          {filtered && <Link href="/partners/list" className={textButton}>Clear filters</Link>}
        </FilterRow>
      </form>

      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '64rem' }}>
            <thead><tr className={eyebrow}>
              {['Partner', 'Category', 'City', 'Contact', 'Status', 'Level', 'Referred', 'Purchased', 'Bills', 'Applied'].map((h, i) =>
                <th key={h} scope="col" className={`${th} ${i >= 6 && i <= 8 ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {partners.length === 0 && <tr><td colSpan={10} className={`${td} py-6 text-center text-ink-muted`}>{filtered ? 'No partner matches these filters.' : 'No applications yet.'}</td></tr>}
              {partners.map((p) => (
                <tr key={p.id} className="border-t border-grid hover:bg-inset/50">
                  <th scope="row" className={`${td} text-left font-medium text-ink`}>
                    <Link href={`/partners/${p.code ?? p.id}`} className="hover:text-accent hover:underline">{p.fullName}</Link>
                    <span className="tnum block text-xs font-normal text-ink-muted">{p.code ?? 'No Partner ID yet'}</span>
                  </th>
                  <td className={`${td} text-ink-2`}>{p.category}</td>
                  <td className={`${td} text-ink-2`}>{p.city}</td>
                  <td className={`${td} text-ink-2`}><span className="tnum">{formatPhone(p.phone)}</span><span className="block text-xs text-ink-muted">{p.email}</span></td>
                  <td className={td}><PartnerBadge status={p.status} />{p.status === 'approved' && !p.documentsComplete && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">Documents pending</span>}</td>
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
