/**
 * Overview: a master summary of every module, and each module's own KPIs under its header link.
 * A visitor sees only the modules they have signed in to (see OVERVIEW_ACCESS_HEADER in proxy.ts).
 */

import Link from 'next/link';
import { headers } from 'next/headers';
import { requireUser } from '@/lib/auth';
import { button, card, control, eyebrow, Kpi, KpiGrid, PageHeader } from '@/components/ui';
import { FilterBox, filterLabel, PlacedFilters } from '@/components/filter-box';
import { monthToDate, pickRange, rangeLabel } from '@/lib/module-filters';
import { loadModuleKpis, type Period } from '@/lib/overview/kpis';
import { OVERVIEW_ACCESS_HEADER, OVERVIEW_MODULES, type OverviewKpi, type OverviewModule } from '@/lib/overview/modules';

export const dynamic = 'force-dynamic';

const external = (href: string) => href.startsWith('http') || href.startsWith('/__gate/');

/** A module's name, as a link straight into that module. */
function ModuleLink({ module: m }: { module: OverviewModule }) {
  const className = 'rounded transition-colors hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
  return external(m.href)
    ? <a href={m.href} className={className}>{m.label}</a>
    : <Link href={m.href} className={className}>{m.label}</Link>;
}

function Unavailable({ locked, module: m }: { locked: boolean; module: OverviewModule }) {
  return (
    <div className={`${card} px-5 py-6 text-sm text-ink-2`}>
      {locked ? <>Sign in to {m.label} to see its figures.</> : 'These figures are not available right now. Try again in a moment.'}
    </div>
  );
}

function SummaryCard({ module: m, kpis, query }: { module: OverviewModule; kpis: OverviewKpi[] | null; query: string }) {
  const shown = (m.headline as readonly string[]).map((label) => kpis?.find((k) => k.label === label)).filter((k): k is OverviewKpi => !!k);
  return (
    <section className={`${card} flex flex-col p-5`} aria-label={m.label}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight text-ink"><ModuleLink module={m} /></h2>
        <Link href={`/flow?m=${m.key}${query}`} className="shrink-0 text-sm font-medium text-accent hover:underline">View KPIs</Link>
      </div>
      {shown.length ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
          {shown.map((k) => (
            <div key={k.label} className="min-w-0">
              <dt className={eyebrow}>{k.label}</dt>
              <dd className="tnum mt-1 truncate text-xl font-semibold tracking-tight text-ink">{k.value}</dd>
            </div>
          ))}
        </dl>
      ) : <p className="mt-4 text-sm text-ink-2">Not available right now.</p>}
    </section>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const range = pickRange(sp, monthToDate());
  const from = range.from!, to = range.to!;
  const current = OVERVIEW_MODULES.find((m) => m.key === sp.m) ?? null;
  const allDates = current?.key === 'marketing' && sp.all === '1';
  const period: Period = { from, to, allDates };
  const query = range.picked ? `&from=${from}&to=${to}` : '';

  const access = new Set(((await headers()).get(OVERVIEW_ACCESS_HEADER) ?? '').split(',').filter(Boolean));
  const allowed = (m: OverviewModule) => access.has('admin') || (!!m.gate && access.has(m.gate));

  const filters = (
    <PlacedFilters>
      <FilterBox>
        <form action="/flow" className="flex flex-wrap items-center justify-end gap-2">
          {current && <input type="hidden" name="m" value={current.key} />}
          <label className={`flex items-center gap-1.5 ${filterLabel}`}>From<input type="date" name="from" defaultValue={from} className={control} /></label>
          <label className={`flex items-center gap-1.5 ${filterLabel}`}>To<input type="date" name="to" defaultValue={to} className={control} /></label>
          <button className={button}>Apply</button>
          {current?.key === 'marketing' && <Link href="/flow?m=marketing&all=1" className={button}>All dates</Link>}
        </form>
      </FilterBox>
    </PlacedFilters>
  );

  if (current) {
    const canSee = allowed(current);
    const kpis = canSee ? await loadModuleKpis(current.key, period) : null;
    return (
      <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader title={<ModuleLink module={current} />} description="The key figures from this module's own dashboard." meta={allDates ? 'All dates' : rangeLabel(from, to)} />
        {filters}
        {kpis ? <KpiGrid>{kpis.map((k) => <Kpi key={k.label} label={k.label} value={k.value} caption={k.caption} />)}</KpiGrid> : <Unavailable locked={!canSee} module={current} />}
      </main>
    );
  }

  const visible = OVERVIEW_MODULES.filter(allowed);
  const loaded = await Promise.all(visible.map(async (m) => ({ module: m, kpis: await loadModuleKpis(m.key, period) })));
  const hidden = OVERVIEW_MODULES.length - visible.length;
  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Master summary" description="The headline figures from every module in one place." meta={rangeLabel(from, to)} />
      {filters}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loaded.map(({ module: m, kpis }) => <SummaryCard key={m.key} module={m} kpis={kpis} query={query} />)}
      </div>
      {hidden > 0 && <p className="text-sm text-ink-muted">{hidden} {hidden === 1 ? 'module is' : 'modules are'} hidden because you have not signed in to {hidden === 1 ? 'it' : 'them'}.</p>}
    </main>
  );
}
