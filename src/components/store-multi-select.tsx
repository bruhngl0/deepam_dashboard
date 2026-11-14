'use client';

/**
 * Store filter that picks any number of stores: a button that opens a checkbox list. Nothing ticked
 * means every store.
 *
 * Two ways to use it:
 * - inside a plain GET form, with `name`: each ticked box submits as `name=CODE`, so the URL gets
 *   `?store=A&store=B` (lib/store-filter's `parseStores` reads that as well as `?store=A,B`);
 * - controlled, with `onChange`: called with the new list after every tick, e.g. to write `?store=A,B`.
 */

import { useEffect, useRef, useState } from 'react';

export function StoreMultiSelect({
  stores,
  value,
  onChange,
  name,
  className = '',
  showCodes = false,
}: {
  stores: { code: string; name: string }[];
  /** The ticked codes; empty for every store. */
  value: string[];
  onChange?: (codes: string[]) => void;
  /** Form field name for the ticked boxes (form use). */
  name?: string;
  className?: string;
  /** Show "(CODE)" after each name. */
  showCodes?: boolean;
}) {
  const [picked, setPicked] = useState<string[]>(value);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const key = value.join(',');
  const [seen, setSeen] = useState(key);

  // Follow the URL when it changes from elsewhere (Clear, back button).
  if (key !== seen) {
    setSeen(key);
    setPicked(value);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const update = (next: string[]) => {
    const ordered = stores.map((s) => s.code).filter((code) => next.includes(code));
    setPicked(ordered);
    onChange?.(ordered);
  };

  const label =
    picked.length === 0 || picked.length === stores.length
      ? 'All stores'
      : picked.length === 1
        ? (stores.find((s) => s.code === picked[0])?.name ?? picked[0])
        : picked.length === 2
          ? picked.map((code) => stores.find((s) => s.code === code)?.name ?? code).join(', ')
          : `${picked.length} stores`;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${className} inline-flex items-center gap-2 text-left`}
      >
        <span className="max-w-[16rem] truncate">{label}</span>
        <span aria-hidden className="text-xs opacity-60">▾</span>
      </button>
      {/* Kept in the DOM while closed so a form still submits the ticked boxes. */}
      <div
        role="listbox"
        aria-multiselectable
        hidden={!open}
        className="absolute left-0 z-50 mt-1 min-w-[14rem] rounded-lg border border-line bg-surface p-1 shadow-lg"
      >
        <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-inset">
          <input type="checkbox" checked={picked.length === 0} onChange={() => update([])} />
          All stores
        </label>
        <div className="my-1 border-t border-line" />
        {stores.map((s) => (
          <label key={s.code} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-inset">
            <input
              type="checkbox"
              name={name}
              value={s.code}
              checked={picked.includes(s.code)}
              onChange={(e) => update(e.target.checked ? [...picked, s.code] : picked.filter((code) => code !== s.code))}
            />
            {s.name}
            {showCodes && <span className="text-xs text-ink-muted">({s.code})</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
