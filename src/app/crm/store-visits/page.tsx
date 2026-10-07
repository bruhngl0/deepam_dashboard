import { requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';
import { getStoreVisits } from '@/lib/queries/store-visits';
import { StoreVisitsTable } from '@/components/store-visits-table';

export const dynamic = 'force-dynamic';
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function one(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function dateParam(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export default async function StoreVisitsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const params = await searchParams;
  const status = one(params.status);
  const visits = await getStoreVisits({
    q: one(params.q),
    status: status === 'active' || status === 'deleted' ? status : undefined,
    from: dateParam(one(params.from)),
    to: dateParam(one(params.to)),
    page: Math.max(1, Number(one(params.page) ?? 1) || 1),
    pageSize: Number(one(params.pageSize) ?? 50) || 50,
  });
  const cards = [
    ['All visits', visits.counts.total],
    ['Active', visits.counts.active],
    ['Deleted', visits.counts.deleted],
    ['Linked to CRM customer', visits.counts.linked],
  ] as const;

  return <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Walk-ins</h1>
      <p className="mt-1 text-sm text-ink-2">Walk-in activity received from WalkTrack.</p>
    </header>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(([label, value]) => <section key={label} className="rounded-lg border border-line bg-surface px-4 py-3">
        <p className="text-xs font-medium text-ink-muted">{label}</p><p className="tnum mt-1 text-xl font-semibold text-ink">{formatNumber(value)}</p>
      </section>)}
    </div>
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <StoreVisitsTable rows={visits.rows} total={visits.total} page={visits.page} pageCount={visits.pageCount} />
    </section>
  </main>;
}
