/** Matching analytics salespeople to employees by name. No database access, so it can be unit tested. */

/** "RAJU M V", "M V Raju" and "m.v. raju" match: the same words in any order (analytics name_key()). */
export function nameKey(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ');
}

export type SalespersonOption = { key: string; name: string; storeCode: string | null };

/**
 * Matches salespeople to employees whose name has the same words, where that name is unique on both sides and
 * neither is linked yet. HR's own choices ('manual', 'none') are never changed. Runs after each analytics refresh.
 */
export function autoLinks(
  employees: { employeeCode: string; fullName: string; salespersonKey: string | null; salespersonLink: string | null }[],
  salespeople: SalespersonOption[],
): { employeeCode: string; key: string }[] {
  const taken = new Set(employees.map((e) => e.salespersonKey).filter(Boolean));
  const count = <T>(list: T[], key: (t: T) => string) => list.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>());
  const empCount = count(employees, (e) => nameKey(e.fullName));
  const spCount = count(salespeople, (s) => nameKey(s.name));
  const byName = new Map(salespeople.map((s) => [nameKey(s.name), s]));
  const out: { employeeCode: string; key: string }[] = [];
  for (const e of employees) {
    const k = nameKey(e.fullName);
    if (e.salespersonLink || e.salespersonKey || !k || empCount.get(k) !== 1 || spCount.get(k) !== 1) continue;
    const s = byName.get(k)!;
    if (taken.has(s.key)) continue;
    taken.add(s.key);
    out.push({ employeeCode: e.employeeCode, key: s.key });
  }
  return out;
}
