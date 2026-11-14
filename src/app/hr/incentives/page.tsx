/**
 * Incentives: each MG Road and Jayanagar salesperson's incentive for one month, by the circulars in
 * lib/incentives/slabs.ts. Weekend staff are marked here (salesperson_incentive_settings).
 */

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { analyticsAsOf, analyticsConfigured } from '@/lib/analytics/db';
import { monthIncentives, monthRange, setWeekendStaff } from '@/lib/incentives/store';
import { AGE_BANDS, INCENTIVE_STORES, INCENTIVES_FROM, LAKH_BANDS, VOLUME_BANDS, WEEKEND, type IncentiveStore } from '@/lib/incentives/slabs';
import { todayIst } from '@/lib/queries/daily';
import { formatCurrency, formatCurrencyCompact, formatDateTime, formatNumber } from '@/lib/format';
import { card, eyebrow, Kpi, KpiGrid, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const FIRST_MONTH = INCENTIVES_FROM.slice(0, 7);

async function toggleWeekend(form: FormData) {
  'use server';
  await requireUser();
  await setWeekendStaff(String(form.get('emp') ?? ''), form.get('on') === '1');
  revalidatePath('/hr/incentives');
}

/** Every month from the circulars' start to this month, newest first. */
function months(): string[] {
  const out: string[] = [];
  const [y0, m0] = FIRST_MONTH.split('-').map(Number), [y1, m1] = todayIst().slice(0, 7).split('-').map(Number);
  for (let y = y1, m = m1; y > y0 || (y === y0 && m >= m0); m === 1 ? (y--, m = 12) : m--) out.push(`${y}-${String(m).padStart(2, '0')}`);
  return out;
}
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const lakhs = (n: number) => `₹${formatNumber(n / 100_000)} L`;

export default async function IncentivesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const list = months();
  const month = list.includes(one(sp.month) ?? '') ? one(sp.month)! : list[0];
  const store = (one(sp.store) === 'STR-002' ? 'STR-002' : one(sp.store) === 'STR-001' ? 'STR-001' : null) as IncentiveStore | null;
  const href = (changes: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const next = { month, store, ...changes };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    return `/hr/incentives?${q}`;
  };

  if (!analyticsConfigured()) {
    return <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Incentives" />
      <p className={`${card} p-6 text-sm text-ink-2`}>This page reads the analytics database, which is not connected here (ANALYTICS_DATABASE_URL).</p>
    </main>;
  }

  const [all, asOf] = await Promise.all([monthIncentives(month), analyticsAsOf()]);
  const rows = (all ?? []).filter((r) => !store || r.store === store).sort((a, b) => b.total - a.total || b.volume - a.volume);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const pill = (active: boolean) => `rounded-full border px-3 py-1 text-sm ${active ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:bg-inset'}`;

  return (
    <main className="mx-auto w-full max-w-[92rem] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Incentives"
        description="Each salesperson's incentive for the month, by the management circulars in effect from 1 September 2026."
        meta={<>{monthName(month)}{asOf ? ` · data as of ${formatDateTime(asOf)}` : ''} · <Link href="/hr/salespeople" className="text-accent hover:underline">All salespeople</Link></>}
      />

      <div className="flex flex-wrap items-center gap-2">
        {list.map((m) => <Link key={m} href={href({ month: m })} className={pill(m === month)} scroll={false}>{monthName(m)}</Link>)}
        <span className="mx-2 h-5 w-px bg-line" />
        {([[null, 'Both stores'], ['STR-001', 'MG Road'], ['STR-002', 'Jayanagar']] as const).map(([code, label]) =>
          <Link key={label} href={href({ store: code })} className={pill(store === code)} scroll={false}>{label}</Link>)}
      </div>

      <KpiGrid>
        <Kpi label="Total incentive" value={formatCurrency(sum((r) => r.total))} caption={`${formatNumber(rows.length)} salespeople · rounded down to ₹10,000 each`} />
        <Kpi label="Business volume" value={formatCurrency(sum((r) => r.volumeIncentive))} caption={`On ${formatCurrencyCompact(sum((r) => r.volume))} of business, old stock left out`} />
        <Kpi label="Age-wise stock" value={formatCurrency(sum((r) => r.ageIncentive))} caption={`On ${formatCurrencyCompact(sum((r) => r.oldStock))} of stock 2 years or older`} />
        <Kpi label="Lakh business" value={formatCurrency(sum((r) => r.lakhIncentive))} caption={`${formatNumber(sum((r) => r.lakhCustomers.reduce((a, b) => a + b, 0)))} customers of ₹1 L or more`} />
      </KpiGrid>

      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: '72rem' }}>
            <thead><tr className={eyebrow}>
              {['Salesperson', 'Store', 'Bills', 'Business', 'Old stock', 'Volume', 'Volume incentive', 'Age-wise', 'Lakh business', 'Total', 'Weekend staff'].map((h, i) =>
                <th key={h} scope="col" className={`whitespace-nowrap px-3 py-3 font-bold ${i < 2 ? 'text-left' : i === 10 ? 'text-center' : 'text-right'}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.empCode} className="border-t border-grid hover:bg-inset/50">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    <Link href={`/hr/salespeople/${r.empCode}?from=${monthRange(month).from}&to=${monthRange(month).to}`} className="hover:text-accent hover:underline">{r.name}</Link>
                    <span className="block text-xs font-normal text-ink-muted">{r.empCode}</span>
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-2">{INCENTIVE_STORES[r.store].name}</td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">{formatNumber(r.bills)}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{formatCurrency(r.business)}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{r.oldStock ? formatCurrency(r.oldStock) : '—'}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink">{formatCurrency(r.volume)}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{r.volumeIncentive ? formatCurrency(r.volumeIncentive) : '—'}{r.weekendStaff && <span className="block text-xs text-ink-muted">weekend rule</span>}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{r.ageIncentive ? formatCurrency(r.ageIncentive) : '—'}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-ink-2">{r.lakhIncentive ? <>{formatCurrency(r.lakhIncentive)}<span className="block text-xs text-ink-muted">{r.lakhCustomers.map((c, i) => (c ? `${c} × ${formatCurrency(LAKH_BANDS[i].amount)}` : '')).filter(Boolean).join(', ')}</span></> : '—'}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right font-semibold text-ink">{formatCurrency(r.total)}{r.calculated !== r.total && <span className="block text-xs font-normal text-ink-muted">from {formatCurrency(r.calculated)}</span>}</td>
                  <td className="px-3 py-2 text-center">
                    <form action={toggleWeekend}>
                      <input type="hidden" name="emp" value={r.empCode} />
                      <input type="hidden" name="on" value={r.weekendStaff ? '0' : '1'} />
                      <button type="submit" className={`rounded-lg border px-2 py-1 text-xs ${r.weekendStaff ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:bg-inset'}`}
                        aria-pressed={r.weekendStaff} aria-label={`${r.name}: weekend staff ${r.weekendStaff ? 'on' : 'off'}`}>{r.weekendStaff ? 'Yes' : 'No'}</button>
                    </form>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={11} className="px-3 py-8 text-center text-ink-muted">No salesperson has bills in {monthName(month)}.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {(Object.keys(INCENTIVE_STORES) as IncentiveStore[]).map((code) => (
          <div key={code} className={`${card} p-4 text-sm`}>
            <h2 className="font-semibold text-ink">{INCENTIVE_STORES[code].name} business volume</h2>
            <p className="text-xs text-ink-muted">Circular {INCENTIVE_STORES[code].circular}</p>
            <ul className="mt-2 space-y-0.5 text-ink-2">
              {VOLUME_BANDS[code].map((b, i, all) => <li key={i} className="flex justify-between gap-4"><span>{lakhs(b.from)}{all[i + 1] ? ` to ${lakhs(all[i + 1].from)}` : ' and above'}</span><span className="tnum">{b.amount ? formatCurrency(b.amount) : 'Nil'}</span></li>)}
              <li className="flex justify-between gap-4 border-t border-grid pt-1"><span>Weekend staff: {lakhs(WEEKEND[code].from)}</span><span className="tnum">{formatCurrency(WEEKEND[code].amount)}</span></li>
            </ul>
          </div>
        ))}
        <div className={`${card} p-4 text-sm`}>
          <h2 className="font-semibold text-ink">Both stores</h2>
          <ul className="mt-2 space-y-0.5 text-ink-2">
            {AGE_BANDS.map((b) => <li key={b.label} className="flex justify-between gap-4"><span>Stock {b.label.toLowerCase()}</span><span className="tnum">{b.rate ? `${b.rate * 100}%` : 'Nil'}</span></li>)}
            {LAKH_BANDS.slice(1).map((b, i, all) => <li key={b.from} className={`flex justify-between gap-4 ${i ? '' : 'border-t border-grid pt-1'}`}><span>One customer {lakhs(b.from)}{all[i + 1] ? ` to ${lakhs(all[i + 1].from)}` : ' and above'}</span><span className="tnum">{formatCurrency(b.amount)}</span></li>)}
          </ul>
        </div>
      </section>

      <section className="space-y-1 text-xs leading-relaxed text-ink-muted">
        <p><b className="text-ink-2">Who and which store:</b> every salesperson with bills credited to them (the salesman printed on the bill), at any location. Their store for the month, and so its slabs, is where they billed the most of MG Road and Jayanagar. A helper named on a line is not credited.</p>
        <p><b className="text-ink-2">Business:</b> the month&rsquo;s sales less returns, as billed (after discount, with GST). <b className="text-ink-2">Old stock:</b> lines whose stock was 2 years or older on the sale day, by inward date; left out of Volume and paid by age instead. Inward dates in the ERP start on 1 May 2026, so nothing reaches 2 years before May 2028.</p>
        <p><b className="text-ink-2">Volume incentive:</b> the flat amount for the band Volume falls in. Weekend staff get the weekend amount instead; mark them with the button. <b className="text-ink-2">Lakh business:</b> each customer&rsquo;s business with the salesperson in the month; a bill with no customer counts alone. <b className="text-ink-2">Total:</b> the three incentives added up, then rounded down to a whole ₹10,000 (₹33,500 is paid as ₹30,000; under ₹10,000 is nil). The figure before rounding is shown under it.</p>
        <p><b className="text-ink-2">Not included:</b> Special Incentive (Scanned Products) 3%, as the sales data does not say which products were scanned.</p>
      </section>
    </main>
  );
}
