/**
 * Reads and checks the two public forms: the partner application (/deepampartner) and the customer registration
 * on a referral link (/deepampartner/<Partner ID>). Both are also posted as JSON from other sites, so every value
 * arrives as `unknown`. Pure: no database.
 */

import { normalizePhone } from '@/lib/phone';
import { APPOINTMENT_MAX_DAYS, OCCASIONS, REFERRAL_BRANDS, REFERRAL_STORES, type ReferralBrand } from './constants';

export type Read = (key: string) => unknown;
type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const text = (read: Read, key: string, max: number) => String(read(key) ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
/** A checkbox from a form ("on"), or `true` / "true" / "yes" from JSON. */
const ticked = (read: Read, key: string) => {
  const v = read(key);
  return v === true || (typeof v === 'string' && ['on', 'true', 'yes', '1'].includes(v.toLowerCase()));
};
/** Hidden from people; a filled value means a bot, which gets the same thank-you and no row. */
export const isBot = (read: Read) => text(read, 'website', 200) !== '';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export type PartnerApplication = { fullName: string; contact: string; phone: string; email: string; category: string; city: string };

/** `categories`: the active partner categories (partner_categories). */
export function parseApplication(read: Read, categories: readonly string[]): Parsed<PartnerApplication> {
  const fullName = text(read, 'fullName', 120);
  const contact = text(read, 'contact', 40);
  const email = text(read, 'email', 160).toLowerCase();
  const category = categories.find((c) => c === text(read, 'category', 60));
  const city = text(read, 'city', 80);
  if (!fullName) return { ok: false, message: 'Please enter your full name.' };
  const phone = normalizePhone(contact);
  if (!phone.ok) return { ok: false, message: 'Please enter a valid 10-digit Indian mobile number.' };
  if (!EMAIL.test(email)) return { ok: false, message: 'Please enter a valid email address.' };
  if (!category) return { ok: false, message: 'Please choose your partner category.' };
  if (!city) return { ok: false, message: 'Please enter your city.' };
  if (!ticked(read, 'consent')) return { ok: false, message: 'Please tick the box to agree to the partner terms.' };
  return { ok: true, value: { fullName, contact, phone: phone.e164, email, category, city } };
}

export type ReferralRegistration = {
  brand: ReferralBrand; fullName: string; contact: string; phone: string; occasion: string;
  storeCode: (typeof REFERRAL_STORES)[number]['code']; appointmentDate: string;
};

/** `today` is the IST date; the appointment must be from today to APPOINTMENT_MAX_DAYS ahead. */
export function parseReferral(read: Read, today: string): Parsed<ReferralRegistration> {
  const fullName = text(read, 'fullName', 120);
  const contact = text(read, 'contact', 40);
  const occasion = OCCASIONS.find((o) => o === text(read, 'occasion', 60));
  // Posted from other sites without a brand: Deepam, as before brands were added.
  const brandText = text(read, 'brand', 40).toLowerCase() || 'deepam';
  const brand = REFERRAL_BRANDS.find((b) => b.key === brandText || b.label.toLowerCase() === brandText);
  const storeText = text(read, 'store', 40);
  // Old Deepam forms send "MG Road" / "Jayanagar".
  const store = REFERRAL_STORES.find((s) => s.brand === brand?.key && (s.code === storeText || s.label === storeText || s.label.split(',')[0] === storeText));
  const appointmentDate = text(read, 'appointmentDate', 10);
  if (!brand) return { ok: false, message: 'Please choose the brand you would like to visit.' };
  if (!fullName) return { ok: false, message: 'Please enter your full name.' };
  const phone = normalizePhone(contact);
  if (!phone.ok) return { ok: false, message: 'Please enter a valid 10-digit Indian mobile number.' };
  if (!occasion) return { ok: false, message: 'Please choose your shopping occasion.' };
  if (!store) return { ok: false, message: 'Please choose your preferred store.' };
  if (!DAY.test(appointmentDate) || Number.isNaN(Date.parse(`${appointmentDate}T00:00:00Z`))) return { ok: false, message: 'Please choose your preferred appointment date.' };
  if (appointmentDate < today || appointmentDate > addDays(today, APPOINTMENT_MAX_DAYS)) {
    return { ok: false, message: `Please choose an appointment date between today and the next ${APPOINTMENT_MAX_DAYS} days.` };
  }
  if (!ticked(read, 'consent')) return { ok: false, message: 'Please tick the box so we can contact you about your visit.' };
  return { ok: true, value: { brand: brand.key, fullName, contact, phone: phone.e164, occasion, storeCode: store.code, appointmentDate } };
}
