/**
 * One buyer, everything the bill-level data supports.
 *
 * Ordered by what someone standing at the counter would want first: who they
 * are and what they are worth, then how they buy (cadence, basket, discount),
 * then where and with whom, then the raw visit log. Every figure comes from
 * `lib/queries/buyers.ts`, which is also the module that documents the two
 * corrections this page depends on — visits are not bills, and recency is
 * measured against the last loaded bill rather than today's date.
 *
 * The page states its own "as of" date in the header rather than leaving the
 * reader to assume the numbers are current. Sales arrive as periodic exports;
 * a profile read two weeks after the last import is describing the file, not
 * the customer's present state, and saying so costs one line.
 *
 * `params` is a Promise in this version of Next — awaited, not read
 * synchronously.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBuyerProfile, parseBuyerId, type BuyerProfile } from '@/lib/queries/buyers';
import { parseDateParam } from '@/lib/queries/dashboard';
import { Finding, Note, Bar } from '@/components/finding-card';
import {
  formatCurrency,
  formatNumber,
  formatPhone,
  formatDate,
  formatDateTime,
  formatPercent,
  orNotProvided,
  CHANNEL_LABEL,
  REMARK_LABEL,
  VALUE_TIER_LABEL,
} from '@/lib/format';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  phonepe: 'PhonePe',
  amex: 'Amex',
  cheque: 'Cheque',
  advance: 'Advance',
  gift: 'Gift voucher',
  creditNote: 'Credit note',
};

function Stat({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">{label}</p>
      <p className="tnum mt-1.5 text-xl font-semibold leading-none tracking-tight text-ink">
        {value}
      </p>
      {caption && <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{caption}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">{label}</p>
      <p className="mt-1 text-sm text-ink">{value}</p>
    </div>
  );
}

/** A labelled split with a bar — the shape used for stores, tender, staff and rhythm. */
function SplitList({
  rows,
  total,
}: {
  rows: { label: string; value: number; caption: string }[];
  total: number;
}) {
  const scale = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="text-ink">{r.label}</span>
            <span className="tnum font-semibold text-ink">{formatPercent(r.value, total)}</span>
          </div>
          <div className="mt-1.5">
            <Bar value={r.value} scale={scale} />
          </div>
          <p className="tnum mt-1 text-xs text-ink-muted">{r.caption}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The one-line characterisation under the buyer's name. Built from the facts
 * in priority order rather than from a stored label — there is no "segment"
 * column anywhere in the schema, and inventing one would be a stored opinion
 * of exactly the kind `lead_touches` was designed to avoid (D-40).
 */
function headline(p: BuyerProfile): string {
  const parts: string[] = [];
  parts.push(
    p.valueTier === 'top10'
      ? `Top 10% by spend — rank ${formatNumber(p.spendRank)} of ${formatNumber(p.buyerCount)}`
      : `${VALUE_TIER_LABEL[p.valueTier]} by spend`,
  );
  parts.push(
    p.visits > 1
      ? `${formatNumber(p.visits)} visits${p.medianVisitGap !== null ? `, typically ${formatNumber(p.medianVisitGap)} days apart` : ''}`
      : 'one visit so far',
  );
  if (p.prior && p.prior.bills > 0) {
    parts.push(
      `returned after ${p.prior.dormantDays !== null ? `${(p.prior.dormantDays / 365).toFixed(1)} years` : 'a gap'} away`,
    );
  }
  return parts.join(' · ');
}

export default async function BuyerProfilePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  // Before any query runs — the proxy redirect is not the boundary.
  await requireUser();

  const { id } = await params;
  const buyerId = parseBuyerId(id);
  if (buyerId === null) notFound();

  const sp = await searchParams;
  const range = {
    from: parseDateParam(one(sp.from)),
    to: parseDateParam(one(sp.to)),
    store: one(sp.store) ?? null,
  };

  const p = await getBuyerProfile(buyerId, range);
  // Either the id does not exist or this buyer has no bill inside the master
  // filter's window — indistinguishable from here, and a 404 either way.
  if (!p) notFound();

  const carried = new URLSearchParams();
  for (const key of ['from', 'to', 'store'] as const) {
    const v = one(sp[key]);
    if (v) carried.set(key, v);
  }
  const backHref = `/crm/buyers${carried.toString() ? `?${carried}` : ''}`;

  const tenderTotal = p.payments.reduce((n, r) => n + r.amount, 0);
  const busiestDay = [...p.byDay].sort((a, b) => b.bills - a.bills)[0];
  const busiestBand = [...p.byBand].sort((a, b) => b.bills - a.bills)[0];
  const topSalesman = p.salesmen[0];
  const salesmanShare = topSalesman ? (100 * topSalesman.spend) / p.totalSpend : 0;

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={backHref}
        className="text-sm font-medium text-accent underline-offset-2 hover:underline"
      >
        ← All buyers
      </Link>

      <header className="mt-3 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {orNotProvided(p.fullName)}
        </h1>
        <p className="tnum mt-1 text-sm text-ink-2">{formatPhone(p.phoneE164)}</p>
        <p className="mt-2 max-w-[80ch] text-sm text-ink-2">{headline(p)}</p>
        <p className="tnum mt-2 text-xs text-ink-muted">
          Figures as of {formatDate(p.dataThrough)}, the last bill loaded — recency below is
          counted from that date, not from today.
        </p>
      </header>

      {/* ── Value ───────────────────────────────────────────────────────── */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Total spend"
          value={formatCurrency(p.totalSpend)}
          caption={`Outspends ${p.spendPercentile.toFixed(1)}% of buyers. Average buyer: ${formatCurrency(p.peerAvgSpend)}.`}
        />
        <Stat
          label="Average bill"
          value={formatCurrency(p.avgBill)}
          caption={`Median ${formatCurrency(p.medianBill)}, largest ${formatCurrency(p.largestBill)}. Book average: ${formatCurrency(p.peerAvgBill)}.`}
        />
        <Stat
          label="Visits"
          value={formatNumber(p.visits)}
          caption={
            p.bills === p.visits
              ? `${formatNumber(p.bills)} bill${p.bills === 1 ? '' : 's'}, one per visit.`
              : `${formatNumber(p.bills)} bills — ${formatNumber(p.bills - p.visits)} of them split off a same-day trip.`
          }
        />
        <Stat
          label="Last purchase"
          value={p.daysSinceLast === 0 ? 'Latest day' : `${formatNumber(p.daysSinceLast ?? 0)} days ago`}
          caption={`${formatDate(p.lastPurchase)}. First seen ${formatDate(p.firstPurchase)}${p.spanDays ? `, ${formatNumber(p.spanDays)} days earlier` : ''}.`}
        />
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Units bought"
          value={formatNumber(p.units)}
          caption={`${(p.units / Math.max(p.bills, 1)).toFixed(1)} per bill, ${(p.units / Math.max(p.visits, 1)).toFixed(1)} per visit.`}
        />
        <Stat
          label="Discount taken"
          value={`${p.discountRate.toFixed(1)}%`}
          caption={`${formatCurrency(p.discount)} off gross, on ${formatNumber(p.discountedBills)} of ${formatNumber(p.bills)} bills.`}
        />
        <Stat
          label="Spend per visit"
          value={formatCurrency(p.avgVisit)}
          caption={
            p.medianVisitGap !== null
              ? `Typical gap between visits: ${formatNumber(p.medianVisitGap)} days.`
              : 'Single visit — no cadence to measure yet.'
          }
        />
        <Stat
          label="Value tier"
          value={VALUE_TIER_LABEL[p.valueTier]}
          caption={`Rank ${formatNumber(p.spendRank)} of ${formatNumber(p.buyerCount)} buyers, ranked on live sales.`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ── Where and with whom ─────────────────────────────────────── */}
        <Finding
          eyebrow="Branch and staff"
          title={
            p.stores.length > 1
              ? `Shops at ${formatNumber(p.stores.length)} branches`
              : `${p.stores[0]?.storeName ?? 'Unknown'} only`
          }
        >
          <SplitList
            total={p.totalSpend}
            rows={p.stores.map((s) => ({
              label: s.storeName,
              value: s.spend,
              caption: `${formatCurrency(s.spend)} across ${formatNumber(s.bills)} bill${s.bills === 1 ? '' : 's'}`,
            }))}
          />
          {p.salesmen.length > 0 && (
            <Note>
              Served by {formatNumber(p.salesmen.length)}{' '}
              {p.salesmen.length === 1 ? 'salesperson' : 'salespeople'} — {topSalesman.code} wrote{' '}
              {salesmanShare.toFixed(0)}% of the spend ({formatNumber(topSalesman.bills)} bill
              {topSalesman.bills === 1 ? '' : 's'}, {formatCurrency(topSalesman.spend)}).
              {p.salesmen.length > 1 &&
                ` Others: ${p.salesmen
                  .slice(1)
                  .map((s) => `${s.code} (${formatCurrency(s.spend)})`)
                  .join(', ')}.`}
            </Note>
          )}
        </Finding>

        {/* ── How they pay ────────────────────────────────────────────── */}
        <Finding
          eyebrow="How they pay"
          title={
            p.payments.length === 0
              ? 'No tender recorded'
              : p.payments.length === 1
                ? `${PAYMENT_LABEL[p.payments[0].method] ?? p.payments[0].method} only`
                : `Splits across ${formatNumber(p.payments.length)} tenders`
          }
        >
          {p.payments.length === 0 ? (
            <Note>
              The payment breakdown is blank on every bill of theirs. 273 bills in the book
              carry none; the money is still counted in the totals above.
            </Note>
          ) : (
            <SplitList
              total={tenderTotal}
              rows={p.payments.map((r) => ({
                label: PAYMENT_LABEL[r.method] ?? r.method,
                value: r.amount,
                caption: `${formatCurrency(r.amount)} on ${formatNumber(r.bills)} bill${r.bills === 1 ? '' : 's'}`,
              }))}
            />
          )}
          <Note>
            Shares are of tender recorded, not of total spend — a bill paid half by card and
            half in cash contributes to both rows, so bill counts here can exceed the{' '}
            {formatNumber(p.bills)} bills above.
            {tenderTotal < p.totalSpend - 1 && (
              <>
                {' '}
                {formatCurrency(p.totalSpend - tenderTotal)} of their spend carries no payment
                breakdown at all and is absent from the split above — the money is still counted
                in the totals at the top of the page.
              </>
            )}
          </Note>
        </Finding>

        {/* ── When they shop ──────────────────────────────────────────── */}
        <Finding
          eyebrow="When they shop"
          title={
            busiestDay && busiestBand
              ? `Mostly ${busiestDay.label}, ${busiestBand.label.split(' · ')[0].toLowerCase()}`
              : 'Not enough visits to read a pattern'
          }
        >
          <SplitList
            total={p.bills}
            rows={p.byDay.map((d) => ({
              label: d.label,
              value: d.bills,
              caption: `${formatNumber(d.bills)} bill${d.bills === 1 ? '' : 's'}, ${formatCurrency(d.spend)}`,
            }))}
          />
          <Note>
            Times are IST; bill timestamps are stored UTC (D-32). This is when checkout
            happened, which trails the decision to buy by however long they were in the store.
            {p.bills < 8 && ' With this few bills, treat the pattern as anecdote, not habit.'}
          </Note>
        </Finding>

        {/* ── History before this window ──────────────────────────────── */}
        <Finding
          eyebrow="Before this sales file"
          title={
            p.prior && p.prior.bills > 0
              ? `${formatNumber(p.prior.bills)} earlier bills worth ${formatCurrency(p.prior.amount)}`
              : p.prior
                ? 'On the loyalty list, no bills recorded'
                : 'No record before this window'
          }
        >
          {p.prior ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Loyalty status" value={orNotProvided(p.prior.loyaltyType)} />
              <Field label="Registered at" value={orNotProvided(p.prior.registeredStore)} />
              <Field label="First bill on record" value={formatDate(p.prior.firstBillDate)} />
              <Field label="Last bill on record" value={formatDate(p.prior.lastBillDate)} />
              {p.prior.dormantDays !== null && (
                <Field
                  label="Gap before returning"
                  value={`${formatNumber(p.prior.dormantDays)} days (${(p.prior.dormantDays / 365).toFixed(1)} years)`}
                />
              )}
            </div>
          ) : (
            <Note>
              Nothing in the loyalty master export for this phone number. That is weaker than
              it sounds: the export covers 110,758 people and reaches only to October 2023, so
              absence means &ldquo;not in that file&rdquo; rather than &ldquo;never bought
              here&rdquo;.
            </Note>
          )}
          {p.prior && p.prior.bills > 0 && (
            <Note>
              This is the evidence that makes them a returning customer rather than a first-time
              one. It is not read from the customer lifecycle field, which labels every buyer
              &ldquo;existing&rdquo; the moment they place any bill at all.
            </Note>
          )}
        </Finding>

        {/* ── Marketing contact ───────────────────────────────────────── */}
        <Finding
          eyebrow="Marketing contact"
          title={
            p.acquisition
              ? `On ${formatNumber(p.acquisition.channels.length)} lead list${p.acquisition.channels.length === 1 ? '' : 's'}`
              : 'Never on a lead list'
          }
        >
          {p.acquisition ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Channels"
                  value={p.acquisition.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(', ')}
                />
                <Field
                  label="Campaigns"
                  value={p.acquisition.campaigns.join(', ') || 'Not provided'}
                />
                <Field
                  label="Tele-calling outcome"
                  value={
                    p.acquisition.finalRemark
                      ? (REMARK_LABEL[p.acquisition.finalRemark] ?? p.acquisition.finalRemark)
                      : 'Not called'
                  }
                />
                <Field
                  label="First touch"
                  value={
                    p.acquisition.touchEstimated
                      ? 'No real date on file'
                      : formatDateTime(p.acquisition.firstTouchAt)
                  }
                />
              </div>
              {p.acquisition.touchEstimated && (
                <Note>
                  The master sheet carries no per-lead dates (D-84), so the touch timestamp is
                  the campaign&rsquo;s creation date — whenever the import happened to run. It
                  proves this person was on the list, not when they were reached, and no
                  time-to-convert can be read from it.
                </Note>
              )}
            </>
          ) : (
            <Note>
              This buyer appears on no lead sheet. 1,853 of the {formatNumber(p.buyerCount)}{' '}
              buyers are in the same position — which is why the dashboard&rsquo;s customer
              table, scoped to leads, cannot show them.
            </Note>
          )}
        </Finding>
      </div>

      {/* ── Visit log ───────────────────────────────────────────────────── */}
      <section className="card mt-3 rounded-2xl border border-line bg-surface">
        <div className="border-b border-grid px-6 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
            Visit log
          </p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-ink">
            {formatNumber(p.visits)} visit{p.visits === 1 ? '' : 's'}, {formatNumber(p.bills)} bill
            {p.bills === 1 ? '' : 's'}
          </h2>
        </div>

        <div className="divide-y divide-grid">
          {p.visitLog.map((visit) => (
            <div key={visit.date} className="px-6 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ink">{formatDate(visit.date)}</p>
                <p className="tnum text-sm text-ink-2">
                  {formatCurrency(visit.spend)} · {formatNumber(visit.qty)} unit
                  {visit.qty === 1 ? '' : 's'}
                  {visit.bills.length > 1 && ` · ${formatNumber(visit.bills.length)} bills`}
                </p>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
                  <thead>
                    <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                      <th className="py-2 pr-4 font-bold">Voucher</th>
                      <th className="py-2 pr-4 font-bold">Time</th>
                      <th className="py-2 pr-4 font-bold">Branch</th>
                      <th className="py-2 pr-4 font-bold">Staff</th>
                      <th className="py-2 pr-4 font-bold">Tender</th>
                      <th className="py-2 pr-4 text-right font-bold">Units</th>
                      <th className="py-2 pr-4 text-right font-bold">Discount</th>
                      <th className="py-2 text-right font-bold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visit.bills.map((b) => (
                      <tr key={b.voucherNo} className="border-t border-grid">
                        <td className="tnum py-2 pr-4 text-ink">{b.voucherNo}</td>
                        <td className="tnum py-2 pr-4 text-ink-2">{formatDateTime(b.billedAt)}</td>
                        <td className="py-2 pr-4 text-ink-2">{b.storeName}</td>
                        <td className="tnum py-2 pr-4 text-ink-2">
                          {orNotProvided(b.salesmanCode)}
                        </td>
                        <td className="py-2 pr-4 text-ink-2">
                          {Object.keys(b.payments).length === 0
                            ? 'Not recorded'
                            : Object.entries(b.payments)
                                .map(([k, v]) => `${PAYMENT_LABEL[k] ?? k} ${formatCurrency(v)}`)
                                .join(' + ')}
                        </td>
                        <td className="tnum py-2 pr-4 text-right text-ink-2">
                          {formatNumber(b.qty)}
                        </td>
                        <td className="tnum py-2 pr-4 text-right text-ink-2">
                          {b.discount > 0 ? formatCurrency(b.discount) : '—'}
                        </td>
                        <td className="tnum py-2 text-right font-medium text-ink">
                          {formatCurrency(b.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-4 max-w-[80ch] text-xs leading-relaxed text-ink-muted">
        Item-level detail — what was actually bought, its category, colour, size and the margin
        on it — is not shown because no item-level sales have been imported yet. The parser,
        importer and schema are all in place; the barcode-wise register just has not been
        uploaded.
      </p>
    </main>
  );
}
