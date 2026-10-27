/**
 * Daily dashboard — one day, every store, across the four apps.
 *
 * When the analytics database is configured (ANALYTICS_DATABASE_URL) every figure comes from it
 * (lib/analytics/daily.ts), refreshed every few minutes. Otherwise walk-ins, sales, calls and
 * follow-ups come from CRM's own tables (lib/queries/daily.ts), and driver visits, commission and
 * stock alerts from RC Dashboard and Vendor Intelligence, fetched live (lib/integration/apps.ts);
 * when either cannot be reached its rows say so and the rest of the page still renders.
 */

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getDailyCrm, isDay, shiftDay, todayIst, type DailyCrm, type DailyStore } from '@/lib/queries/daily';
import { getRcDaily, getStockAlerts, type RcDaily, type StockAlerts } from '@/lib/integration/apps';
import { dailyFromAnalytics } from '@/lib/analytics/daily';
import { Finding, Note } from '@/components/finding-card';
import { WhatsAppShare } from '@/components/whatsapp-share';
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';

export const dynamic = 'force-dynamic';

const UNAVAILABLE = 'Not available right now';

type Column = DailyStore & {
  rc: { visits: number; people: number; commission: number; owed: number; owedVisits: number } | null;
  stock: { agedUnits: number; agedCost: number; low: number } | null;
  /** Stock at cost from the stock report; null for a store the report does not cover. */
  value: { opening: number; sold: number; closing: number } | null;
};

const NOT_CONNECTED = 'Not connected yet';

function Cell({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <td className={`tnum whitespace-nowrap px-3 py-2 text-right ${strong ? 'font-semibold text-ink' : 'text-ink-2'}`}>{children}</td>;
}

function Section({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr className="border-t border-grid bg-inset/60">
      <th colSpan={colSpan} scope="colgroup" className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
        {label}
      </th>
    </tr>
  );
}

function Row({ label, columns, value, total, strong }: { label: string; columns: Column[]; value: (c: Column) => React.ReactNode; total: React.ReactNode; strong?: boolean }) {
  return (
    <tr className="border-t border-grid">
      <th scope="row" className="whitespace-nowrap px-3 py-2 text-left text-sm font-medium text-ink">{label}</th>
      {columns.map((c) => <Cell key={c.storeCode}>{value(c)}</Cell>)}
      <Cell strong={strong ?? true}>{total}</Cell>
    </tr>
  );
}

export default async function DailyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const requested = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const today = todayIst();
  const date = isDay(requested) && requested <= today ? requested : today;
  const requestedStore = Array.isArray(sp.store) ? sp.store[0] : sp.store;
  const pickedStore = requestedStore && /^STR-\d{3}$/.test(requestedStore) ? requestedStore : null;
  const dayLink = (d: string) => `/daily?${new URLSearchParams({ date: d, ...(pickedStore ? { store: pickedStore } : {}) })}`;

  const fromAnalytics = await dailyFromAnalytics(date).catch((error) => {
    console.warn('[daily] analytics', error instanceof Error ? error.message : error);
    return null;
  });
  let crm: DailyCrm, rc: RcDaily | null, stock: StockAlerts | null;
  // Stock history in analytics starts on the day it was built; before that, the live stock alerts as before.
  if (fromAnalytics) ({ crm, rc, stock } = { ...fromAnalytics, stock: fromAnalytics.stock ?? (await getStockAlerts()) });
  else [crm, rc, stock] = await Promise.all([getDailyCrm(date), getRcDaily(date), getStockAlerts()]);
  const allColumns = buildColumns(crm.stores, rc, stock, crm.stockValue);
  // A picked store narrows the table, its totals and the stock alerts to that store; calls and follow-ups stay company-wide.
  const store = allColumns.some((c) => c.storeCode === pickedStore) ? pickedStore : null;
  const columns = store ? allColumns.filter((c) => c.storeCode === store) : allColumns;
  const inStore = (code: string | null) => !store || code === store;
  const sum = (pick: (c: Column) => number) => columns.reduce((n, c) => n + pick(c), 0);

  const walkIns = sum((c) => c.walkIns);
  const converted = sum((c) => c.converted);
  const bills = sum((c) => c.bills);
  const sales = sum((c) => c.sales);
  const units = sum((c) => c.units);
  const prevSales = sum((c) => c.prevSales);
  const mtdSales = sum((c) => c.mtdSales);
  const valued = columns.filter((c) => c.value);
  const stockTotal = valued.length
    ? { opening: valued.reduce((t, c) => t + c.value!.opening, 0), sold: valued.reduce((t, c) => t + c.value!.sold, 0), closing: valued.reduce((t, c) => t + c.value!.closing, 0) }
    : null;
  const stockAsOf = crm.stockValue ? formatDate(`${crm.stockValue.asOf}T12:00:00+05:30`) : null;
  const summary: [string, string][] = [
    ['Total sales', formatCurrency(sales)],
    ['Previous day sales', formatCurrency(prevSales)],
    ['MTD sales', formatCurrency(mtdSales)],
    ['Average bill value', bills ? formatCurrency(sales / bills) : '—'],
    ['Total footfall', formatNumber(walkIns)],
    ['Conversion rate', walkIns ? formatPercent(converted, walkIns) : '—'],
    ['Total units sold', formatNumber(units)],
  ];
  const stockSummary: [string, string][] = [
    ['Opening stock value', stockTotal ? formatCurrency(stockTotal.opening) : '—'],
    ['Stock received', NOT_CONNECTED],
    ['Stock sold (cost)', stockTotal ? formatCurrency(stockTotal.sold) : '—'],
    ['Closing stock', stockTotal ? formatCurrency(stockTotal.closing) : '—'],
  ];
  const unassignedRc = rc && !store ? rc.day.filter((d) => !d.storeCode).reduce((n, d) => n + d.visits, 0) : 0;
  const rcDay = rc ? rc.day.filter((d) => inStore(d.storeCode)) : [];
  const rcOwed = rc ? rc.owed.filter((d) => inStore(d.storeCode)) : [];
  const rcTotal = rc
    ? {
        visits: rcDay.reduce((n, d) => n + d.visits, 0),
        people: rcDay.reduce((n, d) => n + d.people, 0),
        commission: rcDay.reduce((n, d) => n + (d.commission ?? 0), 0),
        owed: rcOwed.reduce((n, d) => n + (d.commission ?? 0), 0),
        owedVisits: rcOwed.reduce((n, d) => n + d.visits, 0),
      }
    : null;
  const whatsappText = dailyText({
    date, scope: store ? `${columns[0].name} (${store})` : 'All stores', columns, summary, stockTotal, stockAsOf,
    rc: rc && rcTotal ? { total: rcTotal, unassigned: unassignedRc } : null,
    stock: stock ? { ...stock, stores: stock.stores.filter((s) => inStore(s.storeCode)) } : null,
    calls: crm.calls, followups: crm.followups,
  });
  const colSpan = columns.length + 2;
  const rcCell = (pick: (r: NonNullable<Column['rc']>) => string) => (c: Column) => (c.rc ? pick(c.rc) : '—');
  const stockCell = (pick: (s: NonNullable<Column['stock']>) => string) => (c: Column) => (c.stock ? pick(c.stock) : '—');

  return (
    <main className="mx-auto w-full max-w-[92rem] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">Daily dashboard</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{formatDate(`${date}T12:00:00+05:30`)}{date === today ? ' · today' : ''}</h1>
          <p className="mt-1 text-sm text-ink-2">{store ? `${columns[0].name} (${store})` : 'Every store'}, across WalkTrack, billing, RC Dashboard and Vendor Intelligence.</p>
        </div>
        <nav aria-label="Choose day" className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={dayLink(shiftDay(date, -1))} className="rounded-lg border border-line px-3 py-2 font-medium text-ink hover:bg-inset">← Previous day</Link>
          <form action="/daily" className="flex items-center gap-2">
            <label className="sr-only" htmlFor="daily-date">Day</label>
            <input id="daily-date" type="date" name="date" defaultValue={date} max={today} className="rounded-lg border border-line bg-surface px-3 py-2 text-ink" />
            <label className="sr-only" htmlFor="daily-store">Store</label>
            <select id="daily-store" name="store" defaultValue={store ?? ''} className="rounded-lg border border-line bg-surface px-3 py-2 text-ink">
              <option value="">All stores</option>
              {allColumns.map((c) => <option key={c.storeCode} value={c.storeCode}>{c.name} ({c.storeCode})</option>)}
            </select>
            <button className="rounded-lg border border-line px-3 py-2 font-medium text-ink hover:bg-inset">Show</button>
          </form>
          {date < today && <Link href={dayLink(shiftDay(date, 1))} className="rounded-lg border border-line px-3 py-2 font-medium text-ink hover:bg-inset">Next day →</Link>}
          <WhatsAppShare text={whatsappText} to={process.env.DAILY_WHATSAPP_TO?.replace(/[^0-9]/g, '') || null} label="WhatsApp export" />
        </nav>
      </header>

      <section aria-label="Summary" className="mb-3 space-y-2.5">
        {[{ items: summary, cols: 'lg:grid-cols-7' }, { items: stockSummary, cols: 'lg:grid-cols-4' }].map(({ items, cols }, i) => (
          <div key={i} className={`grid grid-cols-2 gap-2.5 sm:grid-cols-4 ${cols}`}>
            {items.map(([k, v]) => (
              <div key={k} className="rounded-xl bg-inset px-3 py-2.5">
                <div className="text-xs text-ink-muted">{k}</div>
                <div className={`tnum mt-1 text-base font-semibold tracking-tight ${v === NOT_CONNECTED ? 'text-ink-muted' : 'text-ink'}`}>{v}</div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="card overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">
                <th scope="col" className="px-3 py-3 text-left font-bold">Store</th>
                {columns.map((c) => (
                  <th key={c.storeCode} scope="col" className="px-3 py-3 text-right font-bold">
                    {c.name}<span className="block font-medium normal-case tracking-normal text-ink-muted">{c.storeCode}</span>
                  </th>
                ))}
                <th scope="col" className="px-3 py-3 text-right font-bold text-ink">Total</th>
              </tr>
            </thead>
            <tbody>
              <Section label="Walk-ins (WalkTrack)" colSpan={colSpan} />
              <Row label="Total footfall (walk-ins)" columns={columns} value={(c) => formatNumber(c.walkIns)} total={formatNumber(walkIns)} />
              <Row label="People" columns={columns} value={(c) => formatNumber(c.people)} total={formatNumber(sum((c) => c.people))} />
              <Row label="Converted" columns={columns} value={(c) => formatNumber(c.converted)} total={formatNumber(converted)} />
              <Row label="Conversion rate" columns={columns} value={(c) => (c.walkIns ? formatPercent(c.converted, c.walkIns) : '—')} total={walkIns ? formatPercent(converted, walkIns) : '—'} />

              <Section label="Sales (billing)" colSpan={colSpan} />
              <Row label="Total sales" columns={columns} value={(c) => formatCurrency(c.sales)} total={formatCurrency(sales)} />
              <Row label="Previous day sales" columns={columns} value={(c) => formatCurrency(c.prevSales)} total={formatCurrency(prevSales)} />
              <Row label="MTD sales" columns={columns} value={(c) => formatCurrency(c.mtdSales)} total={formatCurrency(mtdSales)} />
              <Row label="Bills" columns={columns} value={(c) => formatNumber(c.bills)} total={formatNumber(bills)} />
              <Row label="Average bill value" columns={columns} value={(c) => (c.bills ? formatCurrency(c.sales / c.bills) : '—')} total={bills ? formatCurrency(sales / bills) : '—'} />
              <Row label="Total units sold" columns={columns} value={(c) => formatNumber(c.units)} total={formatNumber(units)} />

              <Section label={`Stock value at cost${stockAsOf ? ` · from the stock report of ${stockAsOf}` : ' · no stock report'}`} colSpan={colSpan} />
              <Row label="Opening stock value" columns={columns} value={(c) => (c.value ? formatCurrency(c.value.opening) : '—')} total={stockTotal ? formatCurrency(stockTotal.opening) : '—'} />
              <Row label="Stock received" columns={columns} value={() => '—'} total={NOT_CONNECTED} strong={false} />
              <Row label="Stock sold (cost)" columns={columns} value={(c) => (c.value ? formatCurrency(c.value.sold) : '—')} total={stockTotal ? formatCurrency(stockTotal.sold) : '—'} />
              <Row label="Closing stock" columns={columns} value={(c) => (c.value ? formatCurrency(c.value.closing) : '—')} total={stockTotal ? formatCurrency(stockTotal.closing) : '—'} />

              <Section label={`Driver visits (RC Dashboard)${rc ? '' : ` · ${UNAVAILABLE}`}`} colSpan={colSpan} />
              <Row label="Visits" columns={columns} value={rcCell((r) => formatNumber(r.visits))} total={rcTotal ? formatNumber(rcTotal.visits) : '—'} />
              <Row label="People" columns={columns} value={rcCell((r) => formatNumber(r.people))} total={rcTotal ? formatNumber(rcTotal.people) : '—'} />
              <Row label="Commission (this day)" columns={columns} value={rcCell((r) => formatCurrency(r.commission))} total={rcTotal ? formatCurrency(rcTotal.commission) : '—'} />
              <Row label="Commission not yet paid" columns={columns} value={rcCell((r) => (r.owedVisits ? `${formatCurrency(r.owed)} · ${formatNumber(r.owedVisits)}` : formatCurrency(0)))} total={rcTotal ? `${formatCurrency(rcTotal.owed)} · ${formatNumber(rcTotal.owedVisits)}` : '—'} />

              <Section label={`Stock alerts (Vendor Intelligence)${stock ? ` · stock as of ${formatDate(`${stock.asOf}T12:00:00+05:30`)}` : ` · ${UNAVAILABLE}`}`} colSpan={colSpan} />
              <Row label={`Aged stock (over ${stock?.rules.agedDays ?? 90} days)`} columns={columns} value={stockCell((s) => `${formatNumber(s.agedUnits)} units`)} total={stock ? `${formatNumber(sum((c) => c.stock?.agedUnits ?? 0))} units` : '—'} />
              <Row label="Aged stock at cost" columns={columns} value={stockCell((s) => formatCurrency(s.agedCost))} total={stock ? formatCurrency(sum((c) => c.stock?.agedCost ?? 0)) : '—'} />
              <Row label="Fast sellers running low" columns={columns} value={stockCell((s) => formatNumber(s.low))} total={stock ? formatNumber(sum((c) => c.stock?.low ?? 0)) : '—'} />
            </tbody>
          </table>
        </div>
        <div className="border-t border-grid px-4 py-3 text-xs leading-relaxed text-ink-muted">
          {stockAsOf && <p>Stock value at cost starts from the stock report of {stockAsOf} and takes off the purchase value of everything billed since (or adds back what was billed between this day and the report). Stock received is not connected yet, so goods received after the report are not in it; a new stock report in Hemparshwa resets it. Stores the report does not cover show —.</p>}
          <p>Sales arrive from Hemparshwa OS every few hours{crm.salesThrough ? `; the latest bill loaded is from ${formatDateTime(crm.salesThrough)}` : ''}. Walk-ins arrive from WalkTrack within a minute.</p>
          {rc && <p>Commission not yet paid: commission on visits up to this day that is not marked Paid in RC, and how many visits. {unassignedRc ? `${formatNumber(unassignedRc)} visit${unassignedRc === 1 ? '' : 's'} this day had no store recorded and count only in the Total.` : ''}</p>}
          {stock && <p>Fast sellers: products that sold at least {stock.rules.fastSellerMinSold} units across all stores in the {stock.rules.fastSellerDays} days to {formatDate(`${stock.salesThrough}T12:00:00+05:30`)}, with {stock.rules.lowStockMax} unit or fewer left in that store. Sales are not recorded per store.</p>}
        </div>
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Finding eyebrow="Calls (all stores)" title={`${formatNumber(crm.calls.calls)} call${crm.calls.calls === 1 ? '' : 's'}, ${formatNumber(crm.calls.connected)} connected, ${formatNumber(crm.calls.interested)} interested`}>
          {crm.calls.bySalesperson.length ? (
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted"><th className="py-1 text-left">Salesperson</th><th className="py-1 text-right">Calls</th><th className="py-1 text-right">Connected</th><th className="py-1 text-right">Interested</th></tr></thead>
              <tbody>{crm.calls.bySalesperson.map((r) => <tr key={r.name} className="border-t border-grid"><td className="py-1.5 text-ink">{r.name}</td><td className="tnum py-1.5 text-right">{formatNumber(r.calls)}</td><td className="tnum py-1.5 text-right">{formatNumber(r.connected)}</td><td className="tnum py-1.5 text-right">{formatNumber(r.interested)}</td></tr>)}</tbody>
            </table>
          ) : <Note>No calls logged this day.</Note>}
          <Note>Calls are not tied to a store, so they are counted for the whole company.</Note>
        </Finding>

        <Finding eyebrow="Follow-ups" title={`${formatNumber(crm.followups.dueToday)} due this day, ${formatNumber(crm.followups.overdue)} overdue`}>
          {crm.followups.byStore.length ? (
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted"><th className="py-1 text-left">Preferred store</th><th className="py-1 text-right">Due</th><th className="py-1 text-right">Overdue</th></tr></thead>
              <tbody>{crm.followups.byStore.map((r) => <tr key={r.store} className="border-t border-grid"><td className="py-1.5 text-ink">{r.store}</td><td className="tnum py-1.5 text-right">{formatNumber(r.dueToday)}</td><td className="tnum py-1.5 text-right">{formatNumber(r.overdue)}</td></tr>)}</tbody>
            </table>
          ) : <Note>Nothing due or overdue.</Note>}
          <Note>Open follow-ups on the existing-customer call list, by the store the customer prefers{store ? ' (every store: the preferred store is free text, so it cannot be matched to the picked one)' : ''}.</Note>
        </Finding>
      </div>

      {stock && <StockDetail stock={store ? { ...stock, stores: stock.stores.filter((s) => s.storeCode === store) } : stock} names={new Map(columns.map((c) => [c.storeCode, c.name]))} />}
    </main>
  );
}

function StockDetail({ stock, names }: { stock: StockAlerts; names: Map<string, string> }) {
  const stores = stock.stores.filter((s) => s.aged.items.length || s.lowFastSellers.length);
  if (!stores.length) return null;
  return (
    <section className="mt-3 grid gap-3 lg:grid-cols-2">
      {stores.map((s) => (
        <Finding key={s.storeCode} eyebrow={`Stock alerts · ${s.storeCode}`} title={names.get(s.storeCode) ?? s.storeCode}>
          {s.lowFastSellers.length > 0 && (
            <div>
              <p className="text-sm font-medium text-ink">Fast sellers running low</p>
              <ul className="mt-1 text-sm text-ink-2">{s.lowFastSellers.map((r) => <li key={`${r.vendor}-${r.item}`} className="tnum">{r.vendor} · {r.item}: {formatNumber(r.left)} left, {formatNumber(r.soldLast30Days)} sold in {stock.rules.fastSellerDays} days</li>)}</ul>
            </div>
          )}
          {s.aged.items.length > 0 && (
            <div>
              <p className="text-sm font-medium text-ink">Costliest aged stock</p>
              <ul className="mt-1 text-sm text-ink-2">{s.aged.items.map((r) => <li key={`${r.vendor}-${r.item}`} className="tnum">{r.vendor} · {r.item}: {formatNumber(r.units)} units, {formatCurrency(r.cost)}, oldest from {formatDate(`${r.oldestInward}T12:00:00+05:30`)}</li>)}</ul>
            </div>
          )}
        </Finding>
      ))}
    </section>
  );
}

function buildColumns(stores: DailyStore[], rc: RcDaily | null, stock: StockAlerts | null, value: DailyCrm['stockValue']): Column[] {
  return stores.map((s) => {
    const v = value?.stores.find((x) => x.storeCode === s.storeCode);
    const day = rc?.day.find((d) => d.storeCode === s.storeCode);
    const owed = rc?.owed.find((d) => d.storeCode === s.storeCode);
    const alerts = stock?.stores.find((a) => a.storeCode === s.storeCode);
    return {
      ...s,
      rc: rc ? { visits: day?.visits ?? 0, people: day?.people ?? 0, commission: day?.commission ?? 0, owed: owed?.commission ?? 0, owedVisits: owed?.visits ?? 0 } : null,
      stock: stock ? { agedUnits: alerts?.aged.units ?? 0, agedCost: alerts?.aged.cost ?? 0, low: alerts?.lowFastSellers.length ?? 0 } : null,
      value: v ? { opening: v.opening, sold: v.sold, closing: v.closing } : null,
    };
  });
}

/** The whole day as WhatsApp text: every section of the page, a line per store that had anything. */
function dailyText(d: {
  date: string;
  scope: string;
  columns: Column[];
  summary: [string, string][];
  stockTotal: { opening: number; sold: number; closing: number } | null;
  stockAsOf: string | null;
  rc: { total: { visits: number; people: number; commission: number; owed: number; owedVisits: number }; unassigned: number } | null;
  stock: StockAlerts | null;
  calls: DailyCrm['calls'];
  followups: DailyCrm['followups'];
}): string {
  const cur = formatCurrency;
  const pct = (part: number, whole: number) => (whole ? formatPercent(part, whole) : '—');
  const many = d.columns.length > 1;
  const name = (code: string) => d.columns.find((c) => c.storeCode === code)?.name ?? code;
  const out: string[] = [`*Deepam daily · ${formatDate(`${d.date}T12:00:00+05:30`)}*`, d.scope, ''];
  const section = (title: string, lines: string[]) => { if (lines.length) out.push(`*${title}*`, ...lines, ''); };

  section('Summary', d.summary.map(([k, v]) => `${k}: ${v}`));

  const walked = d.columns.filter((c) => c.walkIns);
  section('Walk-ins (WalkTrack)', walked.length
    ? walked.map((c) => `${many ? `${c.name}: ` : ''}${formatNumber(c.walkIns)} walk-ins, ${formatNumber(c.people)} people, ${formatNumber(c.converted)} converted (${pct(c.converted, c.walkIns)})`)
    : ['No walk-ins']);

  const sold = d.columns.filter((c) => c.bills || c.sales || c.mtdSales);
  section('Sales (billing)', sold.length
    ? sold.map((c) => `${many ? `${c.name}: ` : ''}${cur(c.sales)} · ${formatNumber(c.bills)} bills · avg ${c.bills ? cur(c.sales / c.bills) : '—'} · ${formatNumber(c.units)} units · prev day ${cur(c.prevSales)} · MTD ${cur(c.mtdSales)}`)
    : ['No sales']);

  if (d.rc) {
    const visited = d.columns.filter((c) => c.rc && (c.rc.visits || c.rc.owed));
    const lines = visited.map((c) => `${many ? `${c.name}: ` : ''}${formatNumber(c.rc!.visits)} visits, ${formatNumber(c.rc!.people)} people, commission ${cur(c.rc!.commission)}${c.rc!.owedVisits ? `, not yet paid ${cur(c.rc!.owed)} (${formatNumber(c.rc!.owedVisits)} visits)` : ''}`);
    if (d.rc.unassigned) lines.push(`No store recorded: ${formatNumber(d.rc.unassigned)} visits`);
    if (many && lines.length) lines.push(`Total: ${formatNumber(d.rc.total.visits)} visits, ${formatNumber(d.rc.total.people)} people, commission ${cur(d.rc.total.commission)}, not yet paid ${cur(d.rc.total.owed)} (${formatNumber(d.rc.total.owedVisits)} visits)`);
    section('Driver visits (RC Dashboard)', lines.length ? lines : ['No driver visits']);
  } else section('Driver visits (RC Dashboard)', [UNAVAILABLE]);

  const valued = d.columns.filter((c) => c.value);
  section(`Stock at cost${d.stockAsOf ? ` (from the stock report of ${d.stockAsOf})` : ''}`, d.stockTotal
    ? [
        ...valued.map((c) => `${many ? `${c.name}: ` : ''}opening ${cur(c.value!.opening)}, sold ${cur(c.value!.sold)}, closing ${cur(c.value!.closing)}`),
        ...(many ? [`Total: opening ${cur(d.stockTotal.opening)}, sold ${cur(d.stockTotal.sold)}, closing ${cur(d.stockTotal.closing)}`] : []),
        `Stock received: ${NOT_CONNECTED}`,
      ]
    : ['No stock report']);

  if (d.stock) {
    const lines: string[] = [];
    for (const s of d.stock.stores) {
      if (!s.aged.units && !s.lowFastSellers.length) continue;
      lines.push(`${name(s.storeCode)}: aged over ${d.stock.rules.agedDays} days ${formatNumber(s.aged.units)} units (${cur(s.aged.cost)}), ${formatNumber(s.lowFastSellers.length)} fast sellers running low`);
      for (const r of s.lowFastSellers) lines.push(`  • Low: ${r.vendor} · ${r.item}, ${formatNumber(r.left)} left, ${formatNumber(r.soldLast30Days)} sold in ${d.stock.rules.fastSellerDays} days`);
      for (const r of s.aged.items) lines.push(`  • Aged: ${r.vendor} · ${r.item}, ${formatNumber(r.units)} units, ${cur(r.cost)}`);
    }
    section(`Stock alerts (Vendor Intelligence, stock as of ${formatDate(`${d.stock.asOf}T12:00:00+05:30`)})`, lines.length ? lines : ['No alerts']);
  }

  section(`Calls (all stores): ${formatNumber(d.calls.calls)}, ${formatNumber(d.calls.connected)} connected, ${formatNumber(d.calls.interested)} interested`,
    d.calls.bySalesperson.length ? d.calls.bySalesperson.map((r) => `${r.name}: ${formatNumber(r.calls)} calls, ${formatNumber(r.connected)} connected, ${formatNumber(r.interested)} interested`) : ['No calls logged']);
  section(`Follow-ups: ${formatNumber(d.followups.dueToday)} due, ${formatNumber(d.followups.overdue)} overdue`,
    d.followups.byStore.length ? d.followups.byStore.map((r) => `${r.store}: ${formatNumber(r.dueToday)} due, ${formatNumber(r.overdue)} overdue`) : ['Nothing due or overdue']);

  return out.join('\n').trim();
}
