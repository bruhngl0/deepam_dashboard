import { db } from '@/db';
import { exhibitionRsvps } from '@/db/schema';
import { withExhibitionRsvp } from '@/lib/marketing/exhibition-rsvp';
import { upsertLeadByPhone } from '@/lib/marketing/store';
import { normalizePhone } from '@/lib/phone';

export const DAYS = [
  { value: '2026-10-16', label: 'Friday, 16 October' },
  { value: '2026-10-17', label: 'Saturday, 17 October' },
  { value: '2026-10-18', label: 'Sunday, 18 October' },
];
export const SLOTS = ['10:30 am – 12:30 pm', '12:30 pm – 2:30 pm', '2:30 pm – 4:30 pm', '4:30 pm – 7 pm'];

/**
 * Saves one visit registration and opens its follow-up. Shared by the form on
 * this app and the copy of it on deepam.com, which posts to `/exhb/submit`.
 * `read` returns the raw value of a field; anything missing reads as empty.
 */
export async function registerVisit(read: (key: string) => unknown): Promise<'saved' | 'invalid'> {
  const text = (key: string, max: number) => String(read(key) ?? '').trim().slice(0, max);
  // Hidden from people; a filled value means a bot, which gets the same thank-you and no row.
  if (text('website', 200)) return 'saved';

  const fullName = text('fullName', 120);
  const contact = text('contact', 40);
  if (!fullName || contact.replace(/\D/g, '').length < 10) return 'invalid';

  const phone = normalizePhone(contact);
  const day = DAYS.find((option) => option.value === text('visitDate', 10));
  const slot = SLOTS.find((option) => option === text('visitTime', 30)) ?? '';
  const people = Number.parseInt(text('partySize', 3), 10);
  const partySize = people >= 1 && people <= 50 ? people : null;
  await db.insert(exhibitionRsvps).values({
    fullName,
    contact,
    phone: phone.ok ? phone.e164 : null,
    visitDate: day?.value ?? null,
    visitTime: slot || null,
    partySize,
  });

  // The registration is already saved; a failure here must not cost the visitor their thank-you.
  if (phone.ok) {
    const rsvp = { phone: phone.e164, name: fullName, visitDay: day?.label ?? '', visitSlot: slot, partySize };
    await upsertLeadByPhone(phone.e164, (existing) => withExhibitionRsvp(existing, rsvp))
      .catch((error) => console.error('[exhb] follow-up not created', error));
  }
  return 'saved';
}
