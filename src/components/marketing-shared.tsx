'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { callsForSync, demoData, readDataset, type Dataset } from '@/lib/marketing/local';
export const button = 'inline-flex items-center justify-center rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-inset focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40';
export const primary = `${button} !bg-accent !text-white !border-accent`;
export const input = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-accent';
export const card = 'rounded-2xl border border-line bg-surface p-5';
export const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
export const dateLabel = (s: string) => s ? s.replace('T', ' ').slice(0, 16) : 'Not recorded';
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="flex min-w-0 flex-col gap-1.5 text-sm text-ink-2">{label}{children}</label>; }
const synced = new Set<string>();
/** Pushes logged calls to the shared database. Idempotent server-side; failures are retried on the next load or call. */
export function syncCalls(d: Dataset) {
  const pending = callsForSync(d).filter(c => !synced.has(c.id)).slice(0, 500);
  if (!pending.length) return;
  fetch('/api/marketing/calls', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending) })
    .then(r => { if (r.ok) pending.forEach(c => synced.add(c.id)); }).catch(() => {});
}
export function useMarketing(userId: string) {
  const key = `marketing-local-v1:${userId}`;
  const [data, setData] = useState<Dataset | null>(null);
  const [message, setMessage] = useState('');
  const snapshot = useRef<string | null>(null);
  useEffect(() => {
    function load() {
      try {
        const raw = localStorage.getItem(key);
        const next = raw ? readDataset(raw) : demoData();
        const serialized = JSON.stringify(next);
        if (raw && JSON.parse(raw).version === 1) localStorage.setItem(`${key}:backup-v1`, raw);
        if (raw !== serialized) localStorage.setItem(key, serialized);
        snapshot.current = serialized; setData(next); syncCalls(next);
      } catch { setMessage('Unable to read local records. Your saved data has not been replaced. Check browser storage permissions.'); }
    }
    load();
    const onStorage = (e: StorageEvent) => { if (e.key === key) load(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);
  function save(next: Dataset): boolean {
    try {
      if (localStorage.getItem(key) !== snapshot.current) { setMessage('Records changed in another tab. Reload this page before saving.'); return false; }
      const serialized = JSON.stringify(next);
      localStorage.setItem(key, serialized); snapshot.current = serialized; setData(next); syncCalls(next); return true;
    } catch { setMessage('Could not save locally. Browser storage may be full; existing records were kept.'); return false; }
  }
  return { data, save, message, setMessage };
}
