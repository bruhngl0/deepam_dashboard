'use client';
import { useEffect, useState } from 'react';
import type { Costed, LeadTypeConversions } from '@/lib/marketing/lead-type-conversions';
import { card } from './marketing-shared';

const rupees = (value: number | null) => value === null ? '—' : `₹${Math.round(value).toLocaleString('en-IN')}`;
const pct = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(1)}%` : '—';
const per = (spend: number | null, count: number | null) => spend === null || !count ? '—' : rupees(spend / count);
const day = (value: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const span = (row: Costed) => row.stats.firstLead ? `${day(row.stats.firstLead)} – ${day(row.stats.lastLead)}` : '—';

const headings = ['Leads', 'Converted', 'Conversion rate', 'Bills', 'Sales', 'Spend', 'Cost per lead', 'Cost per conversion', 'Sales per ₹1 spent'];
function cells(row: Costed) {
  const { stats, spend } = row;
  return [stats.leads, stats.converted, pct(stats.converted, stats.leads), stats.bills, rupees(stats.sales), rupees(spend),
    per(spend, row.sheetLeads), per(spend, stats.converted), spend ? `₹${(stats.sales / spend).toFixed(2)}` : '—'];
}
const th = 'whitespace-nowrap px-4 py-3';
const td = 'whitespace-nowrap px-4 py-3';

/** Loads the campaign figures (conversions from the CRM's sales, spend from the Campaign Summary tabs) once per page. */
export function useLeadTypeConversions() {
  const [data, setData] = useState<LeadTypeConversions | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/api/marketing/lead-type-conversions', { cache: 'no-store' })
      .then(async (r) => { const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error ?? 'Could not load store visit and virtual call conversions.'); return body as LeadTypeConversions; })
      .then((body) => { if (live) setData(body); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  return { data, error };
}

/** Store visit and Virtual calls leads, conversions from the CRM's sales and spend from the Campaign Summary tabs. Not affected by the page filters. */
export function LeadTypeConversionsPanel({ data, error }: { data: LeadTypeConversions | null; error: string }) {

  const intro = <div className="p-4"><h2 className="text-lg font-semibold text-ink">Store-visit and virtual-call campaigns</h2><p className="text-xs text-ink-muted">Every Store visit and Virtual calls lead from the Meta and Google lead sheets, of any date. Converted: a CRM bill on the lead’s phone dated on or after the lead date{data?.latestBill ? `; sales are recorded up to ${day(data.latestBill)}` : ''}. Spend and cost per lead come from the sheets’ Campaign Summary tabs. Not affected by the filters above.</p></div>;
  if (!data) return <section className="overflow-hidden rounded-2xl border border-line bg-surface">{intro}<p role="status" className="px-4 pb-4 text-sm text-ink-2">{error || 'Loading…'}</p></section>;

  return <section aria-label="Store-visit and virtual-call campaigns" className="space-y-4">
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      {intro}
      {data.spendError && <p role="status" className="px-4 pb-3 text-sm text-ink">Spend is unavailable: {data.spendError}</p>}
      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">{data.kinds.map((kind) => <div key={kind.kind} className={card}>
        <p className="text-sm text-ink-2">{kind.kind}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{kind.total.stats.converted} <span className="text-base font-normal text-ink-2">of {kind.total.stats.leads} converted · {pct(kind.total.stats.converted, kind.total.stats.leads)}</span></p>
        <p className="mt-2 text-sm text-ink-2">{rupees(kind.total.stats.sales)} sales · {rupees(kind.total.spend)} spent · leads {span(kind.total)}</p>
      </div>)}</div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Lead type', 'Source', 'Lead dates', ...headings].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{data.kinds.flatMap((kind) => [
          ...kind.platforms.filter((p) => p.stats.leads || p.spend).map((p) => <tr key={`${kind.kind}|${p.platform}`} className="border-t border-line text-ink"><td className={td}>{kind.kind}</td><td className={td}>{p.platform}</td><td className={td}>{span(p)}</td>{cells(p).map((v, i) => <td key={i} className={td}>{v}</td>)}</tr>),
          <tr key={`${kind.kind}|total`} className="border-t border-line bg-inset font-semibold text-ink"><td className={td}>{kind.kind}</td><td className={td}>Total</td><td className={td}>{span(kind.total)}</td>{cells(kind.total).map((v, i) => <td key={i} className={td}>{v}</td>)}</tr>,
        ])}</tbody></table></div>
    </div>
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="p-4"><h2 className="text-lg font-semibold text-ink">Spend and conversions by campaign</h2><p className="text-xs text-ink-muted">Every campaign on a lead or in the Campaign Summary tabs. Spend and sheet leads from the Campaign Summary tabs (— when a campaign has no spend there); cost per lead uses the sheet’s lead count. Leads and conversions from the CRM, any date.</p></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-inset text-xs uppercase text-ink-muted"><tr>{['Campaign', 'Type', 'Source', 'Sheet leads', ...headings].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{data.campaigns.length ? data.campaigns.map((c) => <tr key={c.campaign} className="border-t border-line text-ink"><td className={`${td} font-medium`}>{c.campaign}</td><td className={td}>{c.kind}</td><td className={td}>{c.platform}</td><td className={td}>{c.sheetLeads ?? '—'}</td>{cells(c).map((v, i) => <td key={i} className={td}>{v}</td>)}</tr>)
          : <tr><td colSpan={headings.length + 4} className="px-4 py-6 text-center text-ink-muted">No campaigns yet.</td></tr>}</tbody></table></div>
    </div>
  </section>;
}
