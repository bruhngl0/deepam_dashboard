/**
 * Display formatting.
 *
 * Indian digit grouping throughout — ₹2,01,03,733, never ₹20,103,733. Your team
 * reads the first natively and has to decode the second. (D-77)
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat('en-IN');

export function formatCurrency(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return INR.format(Number.isFinite(n) ? n : 0);
}

/** Compact form for stat tiles: ₹2.01 Cr, ₹17.16 L, ₹7,745. */
export function formatCurrencyCompact(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '₹0';
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
  return INR.format(n);
}

export function formatNumber(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return NUM.format(Number.isFinite(n) ? n : 0);
}

export function formatPercent(part: number, whole: number, digits = 1): string {
  if (!whole) return '0.0%';
  return `${((100 * part) / whole).toFixed(digits)}%`;
}

/** '+919845784157' → '98457 84157' */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const national = e164.startsWith('+91') ? e164.slice(3) : e164.replace(/\D/g, '');
  if (national.length !== 10) return e164;
  return `${national.slice(0, 5)} ${national.slice(5)}`;
}

const DATE = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

const DATETIME = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

/** Store-local rendering; storage is always UTC. (D-32) */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return 'Not provided';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? 'Not provided' : DATE.format(d);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return 'Not provided';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? 'Not provided' : DATETIME.format(d);
}

/** Never render a blank cell or the string "null". (D-80) */
export function orNotProvided(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : 'Not provided';
}

export const CHANNEL_LABEL: Record<string, string> = {
  meta: 'Instagram',
  whatsapp: 'WhatsApp',
  walkin: 'Walk-in',
  existing: 'Existing',
  google: 'Google Ads',
  referral: 'Referral',
  other: 'Other',
};

export const LIFECYCLE_BASIS_LABEL: Record<string, string> = {
  prior_purchase: 'Purchased before this campaign window — provable',
  self_declared: 'Told us so on the walk-in form',
  lead_matched: 'Matched a lead record',
  no_lead_match: 'Bought with no lead record — inferred, unverified',
};

export const REMARK_LABEL: Record<string, string> = {
  coming: 'Coming',
  not_connected: 'Not connected',
  not_available: 'Not available',
  busy: 'Busy',
  not_interested: 'Not interested',
  wrong_number: 'Wrong number',
  other: 'Other',
  pending: 'Not yet called',
};
