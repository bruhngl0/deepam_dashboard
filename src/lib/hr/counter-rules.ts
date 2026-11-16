/**
 * Counter target rules, as written on the circulars: "16, 17, 14, 15 below 5000 + 03". Lists of counter codes
 * (the ERP's Item Short Name) joined with "+", each optionally limited by the piece's tag price: "below N" is
 * under N, "above N" is N or more. "5K" and "30k" mean 5,000 and 30,000. No database access, so it is unit tested.
 */

export type CounterRule = { codes: string[]; below: number | null; above: number | null };

/** "03" and "3" are the same counter. */
export const normCode = (code: string | null | undefined) => (code ?? '').trim().replace(/^0+(?=\d)/, '').toUpperCase();

const amount = (s: string) => {
  const m = s.trim().toUpperCase().replace(/[₹,\s]/g, '').match(/^(\d+(?:\.\d+)?)(K|L)?$/);
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'K' ? 1_000 : m[2] === 'L' ? 100_000 : 1);
};

export class RuleError extends Error {}

export function parseRules(text: string): CounterRule[] {
  const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new RuleError('Enter at least one counter code');
  return parts.map((part) => {
    const m = part.match(/^(.*?)\s*\b(below|under|above|over)\s+(.+)$/i);
    const list = (m ? m[1] : part).replace(/\band\b/gi, ',');
    const codes = list.split(/[,\s]+/).map(normCode).filter(Boolean);
    if (!codes.length || codes.some((c) => !/^[0-9A-Z]{1,6}$/.test(c))) throw new RuleError(`Counter codes not understood: "${part}"`);
    if (!m) return { codes, below: null, above: null };
    const n = amount(m[3]);
    if (n === null) throw new RuleError(`Price not understood: "${m[3]}"`);
    const below = /below|under/i.test(m[2]);
    return { codes, below: below ? n : null, above: below ? null : n };
  });
}

export const matches = (rules: CounterRule[], code: string, tagPrice: number) => rules.some((r) =>
  r.codes.includes(normCode(code)) && (r.below === null || tagPrice < r.below) && (r.above === null || tagPrice >= r.above));

/** One row per counter code and tag price at the store: the pieces sold less pieces returned. */
export type SoldRow = { code: string; tagPrice: number; qty: number };

export function soldFor(rules: CounterRule[], rows: SoldRow[]): { total: number; byCode: Map<string, number> } {
  const byCode = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (!matches(rules, r.code, r.tagPrice)) continue;
    total += r.qty;
    byCode.set(normCode(r.code), (byCode.get(normCode(r.code)) ?? 0) + r.qty);
  }
  return { total, byCode };
}

/** Squashed letters, for matching "RAVIKUMAR" to "Ravi Kumar BS". */
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * The circular's assistant names (or Employee IDs) → employees. A name matches the one employee whose name
 * (letters only) equals it or starts with it; anything else is kept as written.
 */
export function resolveAssistants<E extends { employeeCode: string; fullName: string }>(text: string | null, employees: E[]): (E | string)[] {
  return (text ?? '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
    const id = employees.find((e) => e.employeeCode === t.toUpperCase());
    if (id) return id;
    const k = squash(t);
    const exact = employees.filter((e) => squash(e.fullName) === k);
    if (exact.length === 1) return exact[0];
    const starts = employees.filter((e) => squash(e.fullName).startsWith(k));
    return starts.length === 1 && k.length >= 4 ? starts[0] : t;
  });
}
