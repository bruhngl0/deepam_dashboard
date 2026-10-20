'use client';

/**
 * Everything that has happened with one customer, newest first, grouped by
 * IST date. The data comes from `lib/queries/customer-timeline.ts`; this file
 * only renders it and filters by kind.
 */

import { useMemo, useState } from 'react';
import type { TimelineEvent, TimelineKind } from '@/lib/queries/customer-timeline';

const KIND: Record<TimelineKind, { label: string; dot: string }> = {
  bill: { label: 'Bill', dot: 'bg-status-good' },
  walkin: { label: 'Walk-in', dot: 'bg-accent' },
  form: { label: 'Walk-in form', dot: 'bg-accent-soft' },
  campaign: { label: 'Campaign', dot: 'bg-accent-strong' },
  call: { label: 'Call', dot: 'bg-ink-2' },
  followup: { label: 'Follow-up', dot: 'bg-status-critical' },
  booking: { label: 'Booking', dot: 'bg-ink-muted' },
};

const FILTERS: { key: string; label: string; kinds: TimelineKind[] | null }[] = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'bills', label: 'Bills', kinds: ['bill'] },
  { key: 'walkins', label: 'Walk-ins', kinds: ['walkin', 'form'] },
  { key: 'calls', label: 'Calls', kinds: ['call', 'followup'] },
  { key: 'campaigns', label: 'Campaigns', kinds: ['campaign', 'booking'] },
];

const DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const DAY_KEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
// Bills come from exports that may carry a date only; campaign dates can be estimates.
const TIMED = new Set<TimelineKind>(['walkin', 'call', 'followup', 'form']);
const RUPEES =new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function CustomerTimeline({ events }: { events: TimelineEvent[] }) {
  const [filter, setFilter] = useState('all');
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) c[f.key] = f.kinds ? events.filter((e) => f.kinds!.includes(e.kind)).length : events.length;
    return c;
  }, [events]);

  const days = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds ?? null;
    const groups = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      if (kinds && !kinds.includes(e.kind)) continue;
      const key = DAY_KEY.format(new Date(e.at));
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    return [...groups.entries()];
  }, [events, filter]);

  return (
    <section className="card mt-3 rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-grid px-6 py-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">Timeline</p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-ink">
            {events.length ? `${events.length} event${events.length === 1 ? '' : 's'} across bills, walk-ins, calls and campaigns` : 'Nothing recorded yet'}
          </h2>
        </div>
        <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              disabled={!counts[f.key]}
              onClick={() => setFilter(f.key)}
              className={`tnum rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                filter === f.key ? 'border-accent bg-accent text-white' : 'border-line text-ink-2 hover:border-accent hover:text-ink'
              }`}
            >
              {f.label} {counts[f.key] ? <span className="opacity-70">{counts[f.key]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {days.length === 0 ? (
        <p className="px-6 py-6 text-sm text-ink-2">No events of this kind.</p>
      ) : (
        <ol className="divide-y divide-grid">
          {days.map(([key, list]) => (
            <li key={key} className="px-6 py-4">
              <p className="tnum text-xs font-bold uppercase tracking-[0.09em] text-ink-muted">{DAY.format(new Date(list[0].at))}</p>
              <ul className="mt-3 flex flex-col gap-3 border-l border-line pl-4">
                {list.map((e) => (
                  <li key={e.key} className="relative">
                    <span aria-hidden className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${KIND[e.kind].dot}`} />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-sm font-medium text-ink">
                        <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-muted">{KIND[e.kind].label}</span>
                        {e.title}
                      </p>
                      <p className="tnum text-sm text-ink-2">
                        {[e.amount !== null ? RUPEES.format(e.amount) : null, TIMED.has(e.kind) ? TIME.format(new Date(e.at)) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {(e.store || e.by) && (
                      <p className="mt-0.5 text-xs text-ink-2">{[e.store, e.by && (e.kind === 'campaign' ? `via ${e.by}` : `by ${e.by}`)].filter(Boolean).join(' · ')}</p>
                    )}
                    {e.details.map((d) => (
                      <p key={d} className="mt-0.5 max-w-[80ch] text-xs leading-relaxed text-ink-muted">{d}</p>
                    ))}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
