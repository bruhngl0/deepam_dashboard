/**
 * One worklist row, with the outcome logger attached.
 *
 * A client component because it is the only genuinely interactive surface in
 * the app: pick an outcome, optionally type a note, POST it, and have the row
 * visibly leave the list. Everything else in `/crm` is a Server Component
 * reading SQL.
 *
 * Three things this deliberately does *not* do:
 *
 * - It never hides a row optimistically before the POST returns. A store
 *   manager working a call list needs to know the outcome was actually
 *   recorded; a row that vanishes and silently failed to save is worse than
 *   one that takes 300ms.
 * - It shows the score's components rather than just the score. The weights
 *   are an untested hypothesis (see `lib/queries/worklist.ts`), so presenting
 *   a bare "97" as if it were a measurement would overstate what is known.
 * - It offers no "edit" on a logged outcome. The log is append-only (D-40) —
 *   a correction is a second entry, which the API supports by simply posting
 *   again.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatNumber, formatPhone, formatDate, orNotProvided, REMARK_LABEL } from '@/lib/format';
import type { ListKind, ScoreComponent } from '@/lib/queries/worklist';

/** The outcomes worth one tap. `pending`/`other` live in the dropdown, not here. */
const QUICK: { value: string; label: string; tone: string }[] = [
  { value: 'coming', label: 'Coming in', tone: 'border-transparent bg-accent text-on-dark' },
  { value: 'not_connected', label: "Didn't connect", tone: 'border-line bg-surface text-ink-2' },
  { value: 'not_interested', label: 'Not interested', tone: 'border-line bg-surface text-ink-2' },
  { value: 'wrong_number', label: 'Wrong number', tone: 'border-line bg-surface text-ink-2' },
];

export interface WorklistItem {
  customerId: number;
  fullName: string | null;
  phoneE164: string;
  score: number;
  components: ScoreComponent[];
  contactCount: number;
  lastContactedAt: string | null;
  lastOutcome: string | null;
  /** Rendered under the name — whatever identifies this row's opportunity. */
  headline: string;
  /** Secondary facts, shown as a muted line. */
  meta: string;
}

export function WorklistRow({ item, listKind }: { item: WorklistItem; listKind: ListKind }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function log(outcome: string) {
    setSaving(outcome);
    setError(null);
    try {
      const res = await fetch('/api/outreach/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: item.customerId,
          listKind,
          outcome,
          note: note || null,
          score: item.score,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      setSaved(outcome);
      // Re-fetch the server component so suppression takes effect and the
      // row leaves the list on its own, rather than being hidden client-side.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="border-t border-grid px-4 py-4 transition-colors hover:bg-inset/40">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[18rem] flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <a
              href={`/crm/buyers/${item.customerId}`}
              className="font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
            >
              {orNotProvided(item.fullName)}
            </a>
            <span className="tnum text-sm text-ink-2">{formatPhone(item.phoneE164)}</span>
            {item.contactCount > 0 && (
              <span className="rounded-full border border-dashed border-current/30 px-2 py-0.5 text-xs text-ink-muted">
                Contacted {formatNumber(item.contactCount)}×
                {item.lastOutcome ? ` · ${REMARK_LABEL[item.lastOutcome] ?? item.lastOutcome}` : ''}
                {item.lastContactedAt ? ` · ${formatDate(item.lastContactedAt)}` : ''}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink">{item.headline}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{item.meta}</p>
        </div>

        <div className="text-right">
          {/* One decimal, not zero: percentile ranks compress hard at the top of
              a 67,400-row pool, and rounding turns the leading sixty-odd rows
              into an identical "100" that reads as a broken score rather than
              a tight race. */}
          <p className="tnum text-2xl font-semibold leading-none text-ink">{item.score.toFixed(1)}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.09em] text-ink-muted">Score</p>
          <div className="mt-2 space-y-0.5">
            {item.components.map((c) => (
              <p key={c.label} className="tnum text-xs text-ink-muted">
                {c.label} <span className="text-ink-2">{c.points.toFixed(0)}</span>
                <span className="text-ink-muted/70"> · {c.detail}</span>
              </p>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {QUICK.map((q) => (
          <button
            key={q.value}
            type="button"
            disabled={saving !== null || saved !== null}
            onClick={() => log(q.value)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-inset disabled:opacity-50 ${q.tone}`}
          >
            {saving === q.value ? 'Saving…' : q.label}
          </button>
        ))}

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          disabled={saved !== null}
          className="min-w-[12rem] flex-1 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
        />

        {saved && (
          <span className="text-sm font-medium text-accent">
            Logged as {REMARK_LABEL[saved] ?? saved}
          </span>
        )}
        {error && <span className="text-sm text-ink-2">{error}</span>}
      </div>
    </div>
  );
}
