/**
 * The ERP names its branches 'MG', 'JAYANAGAR', 'ONLINE', 'EXHIBITION'; CRM's stores have codes
 * ('MG_ROAD', 'JAYANAGAR', …). A branch is matched by these aliases, then by store code, then by store name.
 */
const BRANCH_ALIASES: Record<string, string> = { MG: 'MG_ROAD', MGROAD: 'MG_ROAD' };

const key = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function storeIdForBranch(
  branch: string | null | undefined,
  stores: { id: number; code: string; name: string }[],
): number | null {
  if (!branch?.trim()) return null;
  const k = key(branch);
  const code = BRANCH_ALIASES[k];
  const found =
    (code && stores.find((s) => s.code === code)) ||
    stores.find((s) => key(s.code) === k) ||
    stores.find((s) => key(s.name) === k);
  return found ? found.id : null;
}
