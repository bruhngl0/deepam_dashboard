/**
 * Reading the module filter strip (components/module-filters.tsx) on the server: the period (`from`/`to` or `month`)
 * and the stores (`store`, comma-separated stores.code values), validated the same way on every page.
 */

import { todayIst } from '@/lib/queries/daily';
import { parseStores } from '@/lib/store-filter';

type Search = Record<string, string | string[] | undefined>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** The picked stores as stores.code values, comma-joined, or null for every store. */
export const pickStores = (sp: Search) => parseStores(sp.store, /^[A-Z0-9_]{1,40}$/);

/** `from`/`to` from the URL (never past today, `from` never after `to`), else the defaults. */
export function pickRange(sp: Search, defaults: { from: string | null; to: string | null }) {
  const today = todayIst();
  const to = DAY.test(one(sp.to)) ? (one(sp.to) > today ? today : one(sp.to)) : defaults.to;
  let from = DAY.test(one(sp.from)) ? one(sp.from) : defaults.from;
  if (from && to && from > to) from = to;
  return { from, to, picked: DAY.test(one(sp.from)) || DAY.test(one(sp.to)) };
}

/** This month's first day to today: the default period on the HR pages. */
export function monthToDate() {
  const today = todayIst();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** `month` from the URL (not after this month); else the month of a carried `to`/`from`; else this month. */
export function pickMonth(sp: Search) {
  const thisMonth = todayIst().slice(0, 7);
  const carried = DAY.test(one(sp.to)) ? one(sp.to).slice(0, 7) : DAY.test(one(sp.from)) ? one(sp.from).slice(0, 7) : '';
  const asked = MONTH.test(one(sp.month)) ? one(sp.month) : carried || thisMonth;
  return asked > thisMonth ? thisMonth : asked;
}

/** "1 Nov 2026 – 17 Nov 2026", or "1 Nov – 17 Nov 2026" in one year. */
export function rangeLabel(from: string | null, to: string | null) {
  const f = (d: string, year = true) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  if (from && to) return `${f(from, from.slice(0, 4) !== to.slice(0, 4))} – ${f(to)}`;
  if (from) return `From ${f(from)}`;
  if (to) return `Up to ${f(to)}`;
  return 'All dates';
}
