/**
 * Ananta Partner Network (Deepam Partners): the fixed lists and labels. Tables and rules: drizzle/0039.
 */

/** Partner categories on the application form. Driver is to be added later: append it here, no migration needed. */
export const PARTNER_CATEGORIES = [
  'Loyal customer',
  'Makeup artist',
  'Stylist',
  'Influencer',
  'Wedding professional',
  'Wedding venue',
  'Community partner',
  'Former Deepam employee',
  'Photographer',
] as const;
export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

export const PARTNER_STATUSES = ['applied', 'approved', 'rejected', 'suspended'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  applied: 'Awaiting decision',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

/** Partner ID: DPR-00001, issued on approval. */
export const PARTNER_CODE = /^DPR-\d{5,}$/;
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

/** Stores a referred customer can choose: `code` is stores.code, `marketing` the Marketing Intelligence store value. */
export const REFERRAL_STORES = [
  { code: 'MG_ROAD', label: 'MG Road', marketing: 'MG' },
  { code: 'JAYANAGAR', label: 'Jayanagar', marketing: 'JAYNAGAR' },
] as const;

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
