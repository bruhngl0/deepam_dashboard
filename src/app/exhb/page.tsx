import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { exhibitionRsvps } from '@/db/schema';
import { withExhibitionRsvp } from '@/lib/marketing/exhibition-rsvp';
import { upsertLeadByPhone } from '@/lib/marketing/store';
import { normalizePhone } from '@/lib/phone';
import { btn } from './styles';

export const metadata: Metadata = {
  title: 'Celebrations of Deepam · 16–18 October',
  description: 'Book your appointment for Celebrations of Deepam at Shubh Convention Centre, JP Nagar, Bengaluru.',
};

const MAP_LINK = 'https://maps.app.goo.gl/eabDBEZHVUNxALJi8';
const THANK_YOU_ROUTE = '/exhb/thank-you';
const DAYS = [
  { value: '2026-10-16', label: 'Friday, 16 October' },
  { value: '2026-10-17', label: 'Saturday, 17 October' },
  { value: '2026-10-18', label: 'Sunday, 18 October' },
];
const SLOTS = ['10:30 am – 12:30 pm', '12:30 pm – 2:30 pm', '2:30 pm – 4:30 pm', '4:30 pm – 7 pm'];

const label = 'mb-2 block font-semibold leading-[1.4em]';
const input = 'block min-h-[calc(20.8px+1.6em+2px)] w-full appearance-none rounded-none border border-[#bfbfbf] bg-white px-5 py-[0.8em] text-base font-light leading-none text-black hover:border-[#737373] focus:border-black focus:outline-none md:leading-[1.3]';
const required = <span aria-hidden="true" className="text-[#a12b2b]">*</span>;

async function register(formData: FormData) {
  'use server';
  const text = (key: string, max: number) => String(formData.get(key) ?? '').trim().slice(0, max);
  // Hidden from people; a filled value means a bot, which gets the same thank-you and no row.
  if (text('website', 200)) redirect(THANK_YOU_ROUTE);

  const fullName = text('fullName', 120);
  const contact = text('contact', 40);
  if (!fullName || contact.replace(/\D/g, '').length < 10) redirect('/exhb?error=1');

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
  redirect(THANK_YOU_ROUTE);
}

export default async function ExhibitionPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return <main className="px-4 pb-14 pt-9 sm:px-[30px] md:pb-20 md:pt-14">
    <div className="mx-auto mb-9 max-w-[720px] text-center">
      <h1 className="mb-6"><Image src="/deepam-logo.png" alt="Deepam by Ananta" width={310} height={119} unoptimized priority className="mx-auto h-auto w-[190px]" /></h1>
      <p className="mb-[0.6em] text-xl font-bold uppercase leading-snug tracking-[0.06em] md:text-2xl">Celebrations of Deepam</p>
      <p className="mb-[1.2em] text-base uppercase leading-snug tracking-[0.06em] md:text-lg">Shubh Convention Centre, JP Nagar, Bengaluru<br /><span className="whitespace-nowrap">16 – 18 October</span></p>
      <p className="mb-[1em]">A three-day celebration of dressing for festivals, weddings &amp; everything in between. Exclusive pieces created specially for our exhibitions.</p>
      <p className="mb-[1.5em]">15% exhibition-exclusive benefit</p>
      <a href={MAP_LINK} target="_blank" rel="noopener noreferrer" className={btn}>Get directions</a>
    </div>

    <form action={register} className="mx-auto max-w-[720px]">
      <fieldset className="mb-[38px]">
        <legend className="mb-5 text-[1.35em] font-semibold">Book your Appointment</legend>
        <div className="grid gap-x-[26px] gap-y-[22px] min-[601px]:grid-cols-2">
          <div className="min-[601px]:col-span-2"><label htmlFor="exhb-name" className={label}>Full Name {required}</label><input id="exhb-name" name="fullName" type="text" required maxLength={120} autoComplete="name" className={input} /></div>
          <div><label htmlFor="exhb-contact" className={label}>Contact Number {required}</label><input id="exhb-contact" name="contact" type="tel" required autoComplete="tel" maxLength={40} pattern="(?=(?:\D*\d){10,})[\d\s+\-()]+" title="Enter a phone number with at least 10 digits" className={input} /></div>
          <div><label htmlFor="exhb-people" className={label}>Number of People</label><input id="exhb-people" name="partySize" type="number" inputMode="numeric" min={1} max={50} className={input} /></div>
          <div><label htmlFor="exhb-date" className={label}>Date</label><select id="exhb-date" name="visitDate" defaultValue="" className={`${input} appearance-auto`}><option value="">Please select a day</option>{DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></div>
          <div><label htmlFor="exhb-time" className={label}>Time</label><select id="exhb-time" name="visitTime" defaultValue="" className={`${input} appearance-auto`}><option value="">Please select a time</option>{SLOTS.map((slot) => <option key={slot}>{slot}</option>)}</select></div>
        </div>
      </fieldset>
      <div aria-hidden="true" className="hidden"><label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label></div>
      {params.error && <p role="alert" className="mb-[18px] text-[#a12b2b]">Please enter your full name and a contact number with at least 10 digits.</p>}
      <div className="text-center"><button className={btn}>Submit</button></div>
    </form>
  </main>;
}
