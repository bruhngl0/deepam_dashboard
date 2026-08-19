/**
 * Worklist — the two outreach lists, and the log of what came of them.
 *
 * The first screen in this app that asks someone to *do* something rather
 * than read something, which changes what it owes the reader. A dashboard
 * that overstates a number wastes a meeting; a worklist that overstates a
 * number wastes a morning of phone calls. So the page leads with what it does
 * not know: how stale the sales file is, how many people the cool-off is
 * hiding, and that the scoring weights have never been checked against an
 * outcome.
 *
 * Tab state lives in the URL (`?list=`) like every other filter here, so a
 * particular list is shareable and the back button works (D-82).
 *
 * `dynamic = 'force-dynamic'` matters more than usual: a cached worklist
 * would keep handing out people who were called an hour ago.
 */

import {
  getReactivationList,
  getSecondVisitList,
  getOutreachSummary,
  COOLOFF_DAYS,
  type ListKind,
} from '@/lib/queries/worklist';
import { WorklistRow, type WorklistItem } from '@/components/worklist-row';
import { WorklistControls } from '@/components/worklist-controls';
import { Pagination } from '@/components/filters';
import { StatTile } from '@/components/stat-tiles';
import { formatCurrency, formatNumber, formatDate, REMARK_LABEL } from '@/lib/format';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `loyalty_customers.loyalty_type` is an open set (D-66) — label what we've seen, pass through the rest. */
const LOYALTY_LABEL: Record<string, string> = {
  loyalty: 'Loyalty member',
  not_registered: 'Not enrolled in loyalty',
};

const LISTS: { kind: ListKind; label: string; blurb: string }[] = [
  {
    kind: 'reactivation',
    label: 'Win back',
    blurb:
      'People with real purchase history who have bought nothing in the loaded sales window. Ranked by lifetime value (50), how often they used to buy (25) and how recently (25).',
  },
  {
    kind: 'second_visit',
    label: 'Second visit',
    blurb:
      '73% of second visits happen within 14 days of the first, and the tail is thin after 28. These are buyers with exactly one visit, still inside that window. Ranked by what they spent (60) and how close they are to the peak (40).',
  },
];

export default async function WorklistPage({ searchParams }: { searchParams: SearchParams }) {
  // Before any query runs — the proxy redirect is not the boundary.
  await requireUser();

  const params = await searchParams;
  const requested = one(params.list);
  const listKind: ListKind = requested === 'second_visit' ? 'second_visit' : 'reactivation';
  const active = LISTS.find((l) => l.kind === listKind)!;

  const filters = {
    q: one(params.q),
    store: one(params.store),
    minScore: Number(one(params.minScore) ?? 0) || undefined,
    includeContacted: one(params.includeContacted) === 'yes',
    page: Number(one(params.page) ?? 1),
    pageSize: Number(one(params.pageSize) ?? 25),
  };

  const [list, summary] = await Promise.all([
    listKind === 'reactivation' ? getReactivationList(filters) : getSecondVisitList(filters),
    getOutreachSummary(),
  ]);

  const pageSize = Math.min(200, Math.max(10, filters.pageSize));
  const pageCount = Math.max(1, Math.ceil(list.meta.total / pageSize));
  const suppressed = list.meta.poolBeforeSuppression - list.meta.total;

  // Both list shapes collapse to the same row contract here rather than in the
  // component, so the row stays a dumb renderer and the copy for each list
  // lives next to the query that justifies it.
  const items: WorklistItem[] = list.rows.map((r) => {
    if ('priorAmount' in r) {
      return {
        customerId: r.customerId,
        fullName: r.fullName,
        phoneE164: r.phoneE164,
        score: r.score,
        components: r.components,
        contactCount: r.contactCount,
        lastContactedAt: r.lastContactedAt,
        lastOutcome: r.lastOutcome,
        headline: `${formatNumber(r.priorBills)} past bills worth ${formatCurrency(r.priorAmount)} — last bought ${formatDate(r.lastBillDate)}`,
        meta: [
          r.registeredStore ? `Registered at ${r.registeredStore}` : null,
          r.loyaltyType ? (LOYALTY_LABEL[r.loyaltyType] ?? r.loyaltyType) : null,
          `${formatNumber(r.daysDormant)} days dormant`,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }
    return {
      customerId: r.customerId,
      fullName: r.fullName,
      phoneE164: r.phoneE164,
      score: r.score,
      components: r.components,
      contactCount: r.contactCount,
      lastContactedAt: r.lastContactedAt,
      lastOutcome: r.lastOutcome,
      headline: `Spent ${formatCurrency(r.visitSpend)} on ${formatNumber(r.units)} unit${r.units === 1 ? '' : 's'}, ${formatNumber(r.daysSince)} days ago`,
      meta: [
        r.storeName,
        r.salesmanCode ? `served by ${r.salesmanCode}` : null,
        `visited ${formatDate(r.visitDate)}`,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  });

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Worklist</h1>
        <p className="mt-1 max-w-[72ch] text-sm text-ink-2">
          Who to call today. Every outcome logged here is appended to the contact history, so a
          person who has been reached drops off the list and the next person moves up.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="On this list"
          value={formatNumber(list.meta.total)}
          caption={`${formatNumber(list.meta.poolBeforeSuppression)} eligible, ${formatNumber(suppressed)} held back`}
          definition={`Anyone contacted in the last ${COOLOFF_DAYS[listKind]} days is suppressed. Toggle "include contacted" to see them.`}
          emphasis
        />
        <StatTile
          label="Contacts logged"
          value={formatNumber(summary.logged)}
          caption={
            summary.byOutcome.length
              ? summary.byOutcome
                  .slice(0, 3)
                  .map((o) => `${REMARK_LABEL[o.outcome] ?? o.outcome} ${formatNumber(o.count)}`)
                  .join(' · ')
              : 'No calls logged yet'
          }
          definition="Every attempt, across both lists. Append-only — a correction is a second entry, never an edit."
        />
        <StatTile
          label="Bought after contact"
          value={formatNumber(summary.convertedAfterContact)}
          caption="People with a bill dated after a logged call"
          definition="The only number that judges whether these lists work. Requires the bill to postdate the contact, so it cannot be inflated by the purchase that put someone on the list."
        />
      </div>

      {/* The freshness warning is prominent by design — this list sends people
          to make phone calls, and a stale file means some of them have already
          been back. */}
      {list.meta.dataAgeDays !== null && list.meta.dataAgeDays > 0 && (
        <div className="mb-4 rounded-2xl border border-dashed border-line bg-inset/50 px-5 py-4">
          <p className="text-sm text-ink">
            Sales data is current through {formatDate(list.meta.dataThrough)} —{' '}
            {formatNumber(list.meta.dataAgeDays)} days ago.
          </p>
          <p className="mt-1 max-w-[80ch] text-xs leading-relaxed text-ink-2">
            Anyone who came back to the store since then is invisible to this query and may still
            appear below. Timing here is measured from today, not from the last loaded bill, because
            what matters for a call is how long the customer has actually had to return — but that
            only works if the file is fresh. Import the latest sales report before working a long
            list.
          </p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {LISTS.map((l) => (
          <a
            key={l.kind}
            href={`/crm/worklist?list=${l.kind}`}
            aria-current={l.kind === listKind ? 'page' : undefined}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              l.kind === listKind
                ? 'bg-inset text-ink'
                : 'text-ink-2 hover:bg-inset hover:text-ink'
            }`}
          >
            {l.label}
          </a>
        ))}
      </div>

      <section className="card rounded-2xl border border-line bg-surface">
        <div className="border-b border-grid px-4 py-4">
          <p className="max-w-[80ch] text-sm text-ink-2">{active.blurb}</p>
          <p className="mt-2 max-w-[80ch] text-xs text-ink-muted">
            The weights are a starting hypothesis, not a measured model — nobody has yet observed
            whether a high score converts better than a low one. Each row shows what produced its
            number, and the score is frozen onto every logged contact so the weights can be checked
            against real outcomes later.
          </p>
          <div className="mt-3">
            <WorklistControls listKind={listKind} total={list.meta.total} />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-ink-2">Nobody matches these filters.</p>
            <p className="mt-1 text-xs text-ink-muted">
              If you have been working this list, everyone eligible may be inside the{' '}
              {COOLOFF_DAYS[listKind]}-day cool-off. Turn on &ldquo;include contacted&rdquo; to see
              them.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <WorklistRow key={item.customerId} item={item} listKind={listKind} />
          ))
        )}

        <div className="border-t border-grid px-4 py-3">
          <Pagination
            page={Math.max(1, filters.page)}
            pageCount={pageCount}
            total={list.meta.total}
            pageSize={pageSize}
          />
        </div>
      </section>
    </main>
  );
}
