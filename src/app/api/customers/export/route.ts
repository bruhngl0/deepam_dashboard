/**
 * Customer table — CSV export.
 *
 * Same filters as the dashboard's customer table (`getCustomersForExport`
 * shares `buildConditions` with `getCustomers`, D-76), applied to every
 * matching row rather than one page — the point of an export is the rows a
 * manager can't see on screen. Read-only: this route never writes anything,
 * so unlike the import routes it needs no destructive-action gate — but it is
 * the single highest-volume way to pull every customer's name, phone and
 * email off this app in one request, so `requireApiUser()` gates it same as
 * the import routes. `proxy.ts` already covers `/api/*`, but that check is
 * optimistic by design (Next's own docs say so); a bulk contact-data export
 * is exactly the request that shouldn't depend on it alone.
 */

import { getCustomersForExport, type CustomerFilters } from '@/lib/queries/customers';
import { parseDateParam } from '@/lib/queries/dashboard';
import {
  formatPhone,
  formatDate,
  formatDateTime,
  CHANNEL_LABEL,
  VALUE_TIER_LABEL,
  VALUE_TIER_ORDER,
  LIFECYCLE_BASIS_LABEL,
  type ValueTierCode,
} from '@/lib/format';
import { toCsv } from '@/lib/csv';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';

function tierParam(value: string | null): ValueTierCode | undefined {
  return VALUE_TIER_ORDER.includes(value as ValueTierCode) ? (value as ValueTierCode) : undefined;
}

const HEADERS = [
  'Name',
  'Phone',
  'Email',
  'Area',
  'City',
  'Date of birth',
  'Anniversary',
  'Store',
  'Lifecycle',
  'Lifecycle basis',
  'Primary channel',
  'Value tier',
  'All channels',
  'Campaigns',
  'Bill count',
  'Total sales (INR)',
  'First sale at',
  'First touch at',
  'Touch estimated',
  'Follow-up outcome',
];

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;

  const params = new URL(request.url).searchParams;

  const filters: Omit<CustomerFilters, 'page' | 'pageSize'> = {
    q: params.get('q') ?? undefined,
    store: params.get('store') ?? undefined,
    channel: params.get('channel') ?? undefined,
    lifecycle: params.get('lifecycle') ?? undefined,
    hasSales: (params.get('hasSales') as 'yes' | 'no' | null) ?? undefined,
    tier: tierParam(params.get('tier')),
    from: parseDateParam(params.get('from')),
    to: parseDateParam(params.get('to')),
    sort: (params.get('sort') as CustomerFilters['sort']) ?? 'sales',
  };

  const rows = await getCustomersForExport(filters);

  const body = toCsv(
    HEADERS,
    rows.map((r) => [
      r.fullName ?? '',
      formatPhone(r.phoneE164),
      r.email ?? '',
      r.area ?? '',
      r.city ?? '',
      formatDate(r.dateOfBirth),
      formatDate(r.anniversary),
      r.storeName ?? '',
      r.lifecycle,
      r.lifecycleBasis ? (LIFECYCLE_BASIS_LABEL[r.lifecycleBasis] ?? r.lifecycleBasis) : '',
      r.primaryChannel ? (CHANNEL_LABEL[r.primaryChannel] ?? r.primaryChannel) : '',
      VALUE_TIER_LABEL[r.valueTier],
      r.channels.map((c) => CHANNEL_LABEL[c] ?? c).join('; '),
      r.campaigns.join('; '),
      r.billCount,
      r.totalSales,
      r.firstSaleAt ? formatDateTime(r.firstSaleAt) : '',
      r.firstTouchAt ? formatDateTime(r.firstTouchAt) : '',
      r.touchEstimated ? 'yes' : 'no',
      r.finalRemark ?? '',
    ]),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="deepam-customers-${stamp}.csv"`,
    },
  });
}
