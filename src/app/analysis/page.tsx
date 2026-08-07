/**
 * Analysis — cuts on the data the dashboard and Insights don't show yet.
 *
 * A "Sales report" dropdown scopes every figure to one committed sales import
 * batch, or leaves it unscoped across every batch loaded (sales are appended,
 * never replaced — D-04, unlike leads, which are wholesale-replaced on every
 * load — D-84). Everything here is still a same-period cut, never a
 * projection: a trend line or a recency-based churn score needs several
 * comparable weekly batches to fit without misstating its own confidence —
 * see the note on `lib/queries/analysis.ts` and the "Not here yet" section
 * below for what's still missing before that's honest.
 */

import {
  getCustomerSegments,
  getOrderValueDistribution,
  getSalesRhythm,
  getSalesmanPerformance,
  getSalesReports,
} from '@/lib/queries/analysis';
import { Finding, Note, Bar } from '@/app/insights/page';
import { ReportSelect } from '@/components/report-select';
import { formatCurrency, formatDate, formatNumber, CHANNEL_LABEL } from '@/lib/format';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const scopeLabel = (key: string) => (key === 'unmatched' ? 'No phone captured' : (CHANNEL_LABEL[key] ?? key));

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Before any query runs — the proxy redirect is not the boundary.
  await requireUser();

  const params = await searchParams;
  const requestedBatch = Array.isArray(params.batch) ? params.batch[0] : params.batch;

  const reports = await getSalesReports();
  // Only a batch id the DB actually has is trusted — a stale bookmark or a
  // hand-edited URL falls back to "all reports" rather than erroring or
  // silently matching nothing (same rule the dashboard uses for `tier`, D-91).
  const selectedReport = reports.find((r) => r.id === requestedBatch);
  const batchId = selectedReport?.id;

  const [segments, orderValue, rhythm, salesmen] = await Promise.all([
    getCustomerSegments(batchId),
    getOrderValueDistribution(batchId),
    getSalesRhythm(batchId),
    getSalesmanPerformance(batchId),
  ]);

  const coreRepeat = segments.segments.find((s) => s.segment === 'repeat_high');
  const maxSegmentShare = Math.max(...segments.segments.map((s) => s.shareOfRevenue), 1);

  const maxDayBills = Math.max(...rhythm.byDay.map((d) => d.bills), 1);
  const maxBandBills = Math.max(...rhythm.byTimeBand.map((b) => b.bills), 1);
  const busiestDay = [...rhythm.byDay].sort((a, b) => b.bills - a.bills)[0];
  const busiestBand = [...rhythm.byTimeBand].sort((a, b) => b.bills - a.bills)[0];

  const topStoreGap = [...orderValue.byStore].sort(
    (a, b) => b.meanBill - b.medianBill - (a.meanBill - a.medianBill),
  )[0];

  const totalSalesmanRevenue = salesmen.reduce((n, s) => n + s.revenue, 0);
  const maxSalesmanRevenue = Math.max(...salesmen.map((s) => s.revenue), 1);

  const earliestLoaded = reports.reduce<string | null>(
    (min, r) => (min === null || r.from < min ? r.from : min),
    null,
  );
  const latestLoaded = reports.reduce<string | null>(
    (max, r) => (max === null || r.to > max ? r.to : max),
    null,
  );

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Analysis</h1>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            Segmentation, basket size, timing and staff performance — cuts the dashboard and
            Insights don&rsquo;t surface. Every figure below is a same-period cut, never a
            forecast; see the note at the bottom for what a real projection needs first.
          </p>
          <p className="tnum mt-2 text-xs text-ink-muted">
            {selectedReport
              ? `Showing only the ${formatDate(selectedReport.from)} – ${formatDate(selectedReport.to)} report — ${formatNumber(selectedReport.bills)} bills, ${formatCurrency(selectedReport.revenue)}.`
              : `Showing every sales report loaded — ${formatNumber(reports.length)} report${reports.length === 1 ? '' : 's'}${earliestLoaded && latestLoaded ? `, ${formatDate(earliestLoaded)} – ${formatDate(latestLoaded)}` : ''}.`}
          </p>
        </div>
        <ReportSelect reports={reports} />
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        <Finding
          eyebrow="Customer segments"
          title={`${formatNumber(coreRepeat?.people ?? 0)} core repeat customers carry ${(coreRepeat?.shareOfRevenue ?? 0).toFixed(1)}% of identified revenue`}
        >
          <div className="flex flex-col gap-3">
            {segments.segments.map((s) => (
              <div key={s.segment}>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-ink">
                    {s.label}
                    <span className="ml-2 text-xs text-ink-muted">
                      {formatNumber(s.people)} people
                    </span>
                  </span>
                  <span className="tnum font-semibold text-ink">
                    {s.shareOfRevenue.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1.5">
                  <Bar value={s.shareOfRevenue} scale={maxSegmentShare} />
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {s.description} Avg spend {formatCurrency(s.avgSpend)}.
                </p>
              </div>
            ))}
          </div>
          <Note>
            Frequency (repeat vs. one-time) crossed with a top-30%-by-spend cut.
            {selectedReport
              ? ' Ranked within this report only — a customer’s tier here can differ from the dashboard’s lifetime value panel, since that ranks across every bill they’ve ever placed.'
              : ' Ranked across every bill loaded, the same population the dashboard’s value tiers use, so this never disagrees with that panel.'}
            {' '}Recency is deliberately left out — a days-since-last-purchase score needs
            multiple, separated weeks of sales to mean anything, and only became possible once
            a second report was loaded.
          </Note>
        </Finding>

        <Finding
          eyebrow="Basket size distribution"
          title={`The average hides the shape: ${topStoreGap ? topStoreGap.key : 'one store'}'s mean bill runs ${formatCurrency((topStoreGap?.meanBill ?? 0) - (topStoreGap?.medianBill ?? 0))} above its median`}
        >
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
              By store
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                    <th className="pb-1.5 text-left font-bold">Store</th>
                    <th className="pb-1.5 text-right font-bold">Bills</th>
                    <th className="pb-1.5 text-right font-bold">Mean</th>
                    <th className="pb-1.5 text-right font-bold">Median</th>
                    <th className="pb-1.5 text-right font-bold">P90</th>
                  </tr>
                </thead>
                <tbody>
                  {orderValue.byStore.map((r) => (
                    <tr key={r.key} className="border-t border-grid">
                      <td className="py-1.5 text-ink">{r.key}</td>
                      <td className="tnum py-1.5 text-right text-ink-2">
                        {formatNumber(r.bills)}
                      </td>
                      <td className="tnum py-1.5 text-right text-ink-2">
                        {formatCurrency(r.meanBill)}
                      </td>
                      <td className="tnum py-1.5 text-right font-medium text-ink">
                        {formatCurrency(r.medianBill)}
                      </td>
                      <td className="tnum py-1.5 text-right text-ink-2">
                        {formatCurrency(r.p90Bill)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t border-grid pt-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
              By channel
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                    <th className="pb-1.5 text-left font-bold">Channel</th>
                    <th className="pb-1.5 text-right font-bold">Bills</th>
                    <th className="pb-1.5 text-right font-bold">Mean</th>
                    <th className="pb-1.5 text-right font-bold">Median</th>
                    <th className="pb-1.5 text-right font-bold">P90</th>
                  </tr>
                </thead>
                <tbody>
                  {orderValue.byChannel.map((r) => (
                    <tr key={r.key} className="border-t border-grid">
                      <td className="py-1.5 text-ink">{scopeLabel(r.key)}</td>
                      <td className="tnum py-1.5 text-right text-ink-2">
                        {formatNumber(r.bills)}
                      </td>
                      <td className="tnum py-1.5 text-right text-ink-2">
                        {formatCurrency(r.meanBill)}
                      </td>
                      <td className="tnum py-1.5 text-right font-medium text-ink">
                        {formatCurrency(r.medianBill)}
                      </td>
                      <td className="tnum py-1.5 text-right text-ink-2">
                        {formatCurrency(r.p90Bill)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Note>
            Median, not mean, is the number to quote for a typical bill — a handful of large
            purchases pull the average up on every row here. P90 is what the top one-in-ten
            bills look like, useful for spotting which store or channel actually brings in the
            occasional big-ticket sale.
          </Note>
        </Finding>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Finding
          eyebrow="Sales rhythm"
          title={`${busiestDay?.label ?? '—'} is the busiest day, ${(busiestBand?.label ?? '').split(' ·')[0] ?? '—'} the busiest time`}
        >
          <div className="flex flex-col gap-2">
            {rhythm.byDay.map((d) => (
              <div key={d.dow}>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-ink">{d.label}</span>
                  <span className="tnum text-ink-2">
                    {formatNumber(d.bills)} bills · {formatCurrency(d.revenue)}
                  </span>
                </div>
                <div className="mt-1">
                  <Bar value={d.bills} scale={maxDayBills} />
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-grid pt-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
              By time of day
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {rhythm.byTimeBand.map((b) => (
                <div key={b.band}>
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-ink">{b.label}</span>
                    <span className="tnum text-ink-2">
                      {formatNumber(b.bills)} bills · {formatCurrency(b.revenue)}
                    </span>
                  </div>
                  <div className="mt-1">
                    <Bar value={b.bills} scale={maxBandBills} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Note>
            Checkout time, not decision time — a bill is timestamped when it&rsquo;s billed, which
            lags however long the customer spent in the store. Useful for staffing shifts, not
            for reading campaign timing.
          </Note>
        </Finding>

        <Finding
          eyebrow="Salesman performance"
          title={`Top 12 of 40 salesman codes, by revenue`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                  <th className="pb-2 text-left font-bold">Code</th>
                  <th className="pb-2 text-left font-bold">Store</th>
                  <th className="pb-2 text-right font-bold">Bills</th>
                  <th className="pb-2 text-right font-bold">Revenue</th>
                  <th className="pb-2 text-right font-bold">Avg bill</th>
                </tr>
              </thead>
              <tbody>
                {salesmen.map((s) => (
                  <tr key={`${s.store}-${s.code}`} className="border-t border-grid align-baseline">
                    <td className="py-2 pr-3 text-ink">{s.code}</td>
                    <td className="py-2 pr-3 text-ink-2">{s.store}</td>
                    <td className="tnum py-2 text-right text-ink-2">{formatNumber(s.bills)}</td>
                    <td className="tnum py-2 text-right font-medium text-ink">
                      <div className="flex items-center justify-end gap-2">
                        <span className="hidden w-16 sm:block">
                          <Bar value={s.revenue} scale={maxSalesmanRevenue} />
                        </span>
                        {formatCurrency(s.revenue)}
                      </div>
                    </td>
                    <td className="tnum py-2 text-right text-ink-2">
                      {formatCurrency(s.avgBill)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            An ops and staffing view, not an individual scorecard — bill count and average size
            both depend on which customers happened to walk up to which counter, not only on
            who&rsquo;s selling. The top 12 above carry{' '}
            {formatCurrency(totalSalesmanRevenue)} of the codes tracked; salesman code is
            captured on 841 of 847 bills.
          </Note>
        </Finding>
      </div>

      <section className="card mt-3 rounded-2xl border border-line bg-surface p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
          Not here yet
        </p>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-ink">
          Three things this page deliberately doesn&rsquo;t attempt
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Forecasting</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              A trend or a revenue projection needs multiple comparable weekly batches. Leads
              are currently replaced wholesale on each weekly import rather than accumulated
              (D-84), so there is no week-over-week series to fit yet.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Campaign ROI / CAC</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              The schema has a spend field on every campaign (enables cost-per-lead and ROAS
              in one join), but it isn&rsquo;t populated on any of the 4 campaigns currently
              loaded — nobody has entered ad spend yet.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">Follow-up effectiveness</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              Whether tele-calling actually moves conversion is answerable in principle — the
              schema has call outcomes — but the current master-sheet workbook carries none;
              that data existed in the older per-channel exports it replaced (D-84).
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
