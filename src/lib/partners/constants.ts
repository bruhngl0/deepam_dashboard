/**
 * Ananta Partner Network (Deepam Partners): the fixed lists and labels. Tables and rules: drizzle/0039.
 */

/** Partner categories live in the database (partner_categories, edited under Rules; drizzle/0047). */

export const PARTNER_STATUSES = ['applied', 'approved', 'on_hold', 'suspended', 'rejected', 'terminated'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  applied: 'Pending approval',
  approved: 'Active',
  on_hold: 'On hold',
  suspended: 'Suspended',
  rejected: 'Rejected',
  terminated: 'Terminated',
};
/** What each status does (program rules §19). */
export const PARTNER_STATUS_MEANING: Record<PartnerStatus, string> = {
  applied: 'Cannot register customers yet.',
  approved: 'Full access: the referral link registers customers and earnings are paid.',
  on_hold: 'New referrals and payouts stopped while under review. Earnings keep counting.',
  suspended: 'New referrals and privileges stopped. Earned commission is kept.',
  rejected: 'Application declined.',
  terminated: 'Partnership closed. Outstanding earnings are settled as agreed.',
};
/** Status changes staff can make from each status. */
export const STATUS_MOVES: Record<PartnerStatus, PartnerStatus[]> = {
  applied: ['approved', 'rejected'],
  approved: ['on_hold', 'suspended', 'terminated'],
  on_hold: ['approved', 'suspended', 'terminated'],
  suspended: ['approved', 'terminated'],
  rejected: ['approved'],
  terminated: [],
};
/** Statuses with a Partner ID: the dashboard still opens for all of them. */
export const ISSUED_STATUSES: PartnerStatus[] = ['approved', 'on_hold', 'suspended', 'terminated'];

/** Partner ID: APR-00001 (Ananta Partner), issued on approval. Until 28 Nov 2026 it was DPR-00001 (drizzle/0049). */
export const PARTNER_CODE = /^APR-\d{5,}$/;
/** A Partner ID as typed or from an old link: upper-cased, and DPR-00001 read as APR-00001. */
export const normalizePartnerCode = (code: string) => code.trim().toUpperCase().replace(/^DPR-(?=\d{5,}$)/, 'APR-');
export const LEVELS = [1, 2, 3, 4, 5] as const;

/** Legal documents collected after approval. Only the date each was received is stored, never the numbers. */
export const PARTNER_DOCUMENTS = [
  { key: 'agreement', label: 'Signed partner agreement' },
  { key: 'pan', label: 'PAN card' },
  { key: 'id_proof', label: 'Aadhaar or other ID proof' },
  { key: 'bank', label: 'Bank details (cancelled cheque)' },
  { key: 'gst', label: 'GST certificate (if registered)', optional: true },
] as const;
export type PartnerDocumentKey = (typeof PARTNER_DOCUMENTS)[number]['key'];
export const REQUIRED_DOCUMENTS = PARTNER_DOCUMENTS.filter((d) => !('optional' in d)).map((d) => d.key);

/** Shopping occasions on the customer registration form. */
export const OCCASIONS = ['Wedding', 'Engagement', 'Reception', 'Festival', 'Party or celebration', 'Gifting', 'Everyday wear', 'Other'] as const;

/** Brands a referred customer can choose on the referral form, each with its stores. */
export const REFERRAL_BRANDS = [
  { key: 'deepam', label: 'Deepam' },
  { key: 'kalaniketan', label: 'Kalaniketan' },
] as const;
export type ReferralBrand = (typeof REFERRAL_BRANDS)[number]['key'];

/**
 * Stores a referred customer can choose. Deepam's are CRM stores: `code` is stores.code, `marketing` the Marketing
 * Intelligence store value. Kalaniketan's are not in the CRM (no `code`): the store is kept by name.
 */
export const REFERRAL_STORES = [
  { brand: 'deepam', code: 'MG_ROAD', label: 'MG Road, Bengaluru', marketing: 'MG' },
  { brand: 'deepam', code: 'JAYANAGAR', label: 'Jayanagar, Bengaluru', marketing: 'JAYNAGAR' },
  { brand: 'kalaniketan', code: 'KN_JUHU', label: 'Juhu, Mumbai', marketing: null },
  { brand: 'kalaniketan', code: 'KN_SURAT', label: 'Ghod Dod Road, Surat', marketing: null },
] as const;
/** Stores that are CRM stores (stores.code). */
export const CRM_REFERRAL_STORES = ['MG_ROAD', 'JAYANAGAR'];

/** Furthest ahead a customer can pick an appointment. */
export const APPOINTMENT_MAX_DAYS = 90;

export const REFERRAL_STATUSES = ['registered', 'converted', 'expired', 'declined'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  registered: 'Registered',
  converted: 'Purchased',
  expired: 'Window closed',
  declined: 'Not accepted',
};

export type DeclineReason = 'recent_purchase' | 'already_referred' | 'own_number' | 'internal_number';
/** For staff. */
export const DECLINE_LABEL: Record<DeclineReason, string> = {
  recent_purchase: 'Already a customer (bought in the look-back period)',
  already_referred: 'Already registered by a partner',
  own_number: "Partner's own number",
  internal_number: 'Store, staff or test number',
};
/** For the customer on the form, and the partner on their dashboard: never says what or when someone bought. */
export const DECLINE_MESSAGE: Record<DeclineReason, string> = {
  recent_purchase: 'This number is already registered with Deepam, so it cannot be added through a partner link. You are always welcome to visit us.',
  internal_number: 'This number is already registered with Deepam, so it cannot be added through a partner link. You are always welcome to visit us.',
  already_referred: 'This number has already been registered through a Deepam partner.',
  own_number: 'Partners cannot register their own number through their referral link.',
};
export const DECLINE_SHORT: Record<DeclineReason, string> = {
  recent_purchase: 'Existing Deepam customer',
  internal_number: 'Existing Deepam customer',
  already_referred: 'Already registered through a partner link',
  own_number: 'Your own number',
};

export const COMMISSION_STATUSES = ['pending', 'validated', 'rejected', 'paid'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];
export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  pending: 'To validate',
  validated: 'Validated',
  rejected: 'Rejected',
  paid: 'Paid',
};

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
