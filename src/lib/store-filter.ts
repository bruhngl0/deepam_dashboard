/**
 * The store filter carries one or more store codes in a single `?store=` param, comma-separated
 * (`?store=MG_ROAD,JAYANAGAR`); a lone code is the one-store case and keeps working as before.
 * Repeated params (`?store=A&store=B`) are accepted too.
 *
 * `parseStores` is the only gate a code passes through before it reaches SQL: every code must match
 * `pattern`, duplicates go, and the list is sorted so equal selections give equal URLs. The result is
 * the comma-joined list, or null for "every store", so it can be bound as one text parameter and
 * matched with `= ANY(string_to_array($n, ','))`.
 */
export function parseStores(value: string | string[] | null | undefined, pattern: RegExp): string | null {
  const codes = storeCodes(Array.isArray(value) ? value.join(',') : value).filter((code) => pattern.test(code));
  return codes.length ? [...new Set(codes)].sort().join(',') : null;
}

/** The codes in a parsed store list; empty for every store. */
export function storeCodes(stores: string | null | undefined): string[] {
  return (stores ?? '').split(',').map((code) => code.trim()).filter(Boolean);
}

/** Whether `code` passes the filter (always, when no store is picked). */
export function storeMatches(stores: string | null | undefined, code: string | null | undefined): boolean {
  const codes = storeCodes(stores);
  return codes.length === 0 || (!!code && codes.includes(code));
}

/** "All stores", the one store's name, or "MG Road, Jayanagar". */
export function storesLabel(stores: string | null | undefined, list: { code: string; name: string }[]): string {
  const codes = storeCodes(stores);
  if (!codes.length) return 'All stores';
  return codes.map((code) => list.find((s) => s.code === code)?.name ?? code).join(', ');
}
