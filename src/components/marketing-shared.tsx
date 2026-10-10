'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { callsForSync, campaignName, type Dataset, type Lead, type Sale } from '@/lib/marketing/local';
import { routeLabel } from '@/lib/marketing/sheet-routing';
export const button = 'inline-flex items-center justify-center rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-inset focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40';
export const primary = `${button} !bg-accent !text-white !border-accent`;
export const input = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-accent';
export const card = 'rounded-2xl border border-line bg-surface p-5';
export const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
export const dateLabel = (s: string) => s ? s.replace('T', ' ').slice(0, 16) : 'Not recorded';
export const dayMonthYearLabel = (s: string) => {
  const [year, month, day] = s.slice(0, 10).split('-');
  return year && month && day ? `${day}-${month}-${year}` : 'Not recorded';
};
export const dayMonthYearTimeLabel = (s: string) => s.length >= 16 ? `${dayMonthYearLabel(s)} ${s.slice(11, 16)}` : dayMonthYearLabel(s);

/** Shubh Convention / BLVD Club style tag for a routed campaign lead; nothing otherwise. */
export function CampaignTag({ lead }: { lead: Lead }) {
  const label = routeLabel(lead.claimGroup);
  return label ? <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">{label}</span> : null;
}

/** Source · campaign · date-time · store line shown under a lead everywhere it is listed. */
export function LeadMeta({ lead, className = 'mt-3' }: { lead: Lead; className?: string }) {
  return <div className={`${className} flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted`}>
    <span>{[...new Set(lead.acquisitions.map(acquisition => acquisition.source))].join(', ')}</span>
    <span>{[...new Set(lead.acquisitions.map(acquisition => campaignName(acquisition.campaignId)).filter(Boolean))].join(', ') || 'No campaign'}</span>
    <span>{dayMonthYearTimeLabel(lead.acquiredAt)}</span>
    <span>{lead.preferredStore || 'Store not recorded'}</span>
  </div>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="flex min-w-0 flex-col gap-1.5 text-sm text-ink-2">{label}{children}</label>; }
const synced = new Set<string>();
/** Pushes logged calls to the shared database. Idempotent server-side; failures are retried on the next load or call. */
export function syncCalls(d: Dataset) {
  const pending = callsForSync(d).filter(c => !synced.has(c.id)).slice(0, 500);
  if (!pending.length) return;
  fetch('/api/marketing/calls', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending) })
    .then(r => { if (r.ok) pending.forEach(c => synced.add(c.id)); }).catch(() => {});
}
const DATASET = '/api/marketing/dataset';
const REFRESH_MS = 60_000;
const WRITE_CHUNK = 500;
async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json() as T;
}
async function pages<T>(part: 'leads' | 'sales'): Promise<T[]> {
  const all: T[] = [];
  for (let after: number | null = 0; after !== null;) {
    const page: { rows: T[]; next: number | null } = await getJson(`${DATASET}?part=${part}&after=${after}`);
    all.push(...page.rows); after = page.next;
  }
  return all;
}
/**
 * The shared marketing dataset. Records live in the database, so every desk
 * sees the same leads and the Google Sheet sync can add to them. `save` shows
 * the change at once and writes it in the background; if the server refuses
 * it (someone else changed the same lead, or the request failed) the change is
 * rolled back by reloading, with a message.
 */
export function useMarketing() {
  const [data, setData] = useState<Dataset | null>(null);
  const [message, setMessage] = useState('');
  const current = useRef<Dataset | null>(null);
  const versions = useRef<Record<string, number>>({});
  const stamp = useRef('');
  const writes = useRef(0);
  const stale = useRef(false);
  const saves = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(async () => {
    if (writes.current) return;
    const started = saves.current;
    try {
      const { stamp: latest } = await getJson<{ stamp: string }>(`${DATASET}?part=stamp`);
      if (latest === stamp.current && current.current) return;
      const [leads, sales] = await Promise.all([pages<{ lead: Lead; version: number }>('leads'), pages<Sale>('sales')]);
      if (saves.current !== started) return; // Loaded around a save, so this copy may predate it; the next poll reloads.
      const first = !current.current;
      const next: Dataset = { version: 2, demo: false, leads: leads.map(r => r.lead), sales };
      versions.current = Object.fromEntries(leads.map(r => [r.lead.id, r.version]));
      stamp.current = latest; current.current = next; setData(next);
      if (first) syncCalls(next);
    } catch { if (!current.current) setMessage('Unable to load marketing records. Check your connection and reload this page.'); }
  }, []);
  useEffect(() => {
    const tick = () => { if (!document.hidden) void refresh(); };
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [refresh]);
  function save(next: Dataset): boolean {
    const before = current.current;
    if (!before) return false;
    const old = new Map(before.leads.map(l => [l.id, l]));
    const leads = next.leads.filter(l => old.get(l.id) !== l);
    const known = new Set(before.sales.map(s => s.invoice));
    const sales = next.sales.filter(s => !known.has(s.invoice));
    if (!leads.length && !sales.length) return true;
    current.current = next; setData(next); writes.current++; saves.current++;
    queue.current = queue.current.then(async () => {
      try {
        for (let i = 0; i < Math.max(leads.length, sales.length); i += WRITE_CHUNK) {
          const body = { leads: leads.slice(i, i + WRITE_CHUNK).map(lead => ({ lead, version: versions.current[lead.id] ?? 0 })), sales: sales.slice(i, i + WRITE_CHUNK) };
          const r = await fetch(DATASET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const saved = await r.json() as { versions: Record<string, number>; conflicts: string[] };
          Object.assign(versions.current, saved.versions);
          if (saved.conflicts.length) { stale.current = true; setMessage(`${saved.conflicts.length === 1 ? 'A record was' : `${saved.conflicts.length} records were`} changed by someone else at the same time, so your change to ${saved.conflicts.length === 1 ? 'it' : 'them'} was not saved. The latest records are shown; please redo it.`); }
        }
        syncCalls(next);
      } catch { stale.current = true; setMessage('Could not save to the server, so your last change was not kept. The latest saved records are shown; check your connection and try again.'); }
      finally {
        writes.current--;
        if (!writes.current && stale.current) { stale.current = false; stamp.current = ''; void refresh(); }
      }
    });
    return true;
  }
  return { data, save, message, setMessage, refresh };
}
