import { isIntegrationAuthorized } from '@/lib/integration/auth';
import { registerVendorAndCategoryNames } from '@/lib/integration/register-names';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAMES = 5000;

function names(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_NAMES) return null;
  const out = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    if (trimmed) out.add(trimmed);
  }
  return [...out];
}

/**
 * CRM owns the Vendor and Category IDs. Other apps post the names they hold;
 * unknown names are registered (which assigns the next ID) and every name comes
 * back with its ID, keyed by the name exactly as it was sent (trimmed).
 */
export async function POST(request: Request) {
  if (!isIntegrationAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { vendors?: unknown; categories?: unknown } | null;
  const vendorNames = names(body?.vendors);
  const categoryNames = names(body?.categories);
  if (!body || !vendorNames || !categoryNames) {
    return Response.json({ error: `Expected { vendors?: string[], categories?: string[] } with at most ${MAX_NAMES} names each` }, { status: 422 });
  }

  return Response.json(await registerVendorAndCategoryNames(vendorNames, categoryNames));
}
