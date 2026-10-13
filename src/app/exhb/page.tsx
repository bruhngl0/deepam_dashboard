import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { exhibitionRsvps } from '@/db/schema';
import { withExhibitionRsvp } from '@/lib/marketing/exhibition-rsvp';
import { upsertLeadByPhone } from '@/lib/marketing/store';
import { normalizePhone } from '@/lib/phone';

export const metadata: Metadata = {
  title: 'Celebrations of Deepam · 16–18 October',
  description: 'Plan your visit to Celebrations of Deepam at Shubh Convention Centre, JP Nagar, Bengaluru.',
};

const MAP_LINK = 'https://maps.app.goo.gl/eabDBEZHVUNxALJi8';
const THANK_YOU_ROUTE = '/exhb/thank-you';
const DAYS = [
  { value: '2026-10-16', label: 'Friday, 16 October' },
  { value: '2026-10-17', label: 'Saturday, 17 October' },
  { value: '2026-10-18', label: 'Sunday, 18 October' },
];

const label = 'flex flex-col gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-[#5c5c5c]';
const input = 'w-full rounded-lg border border-black/15 bg-white px-3.5 py-3 text-base font-normal normal-case tracking-normal text-[#232323] [color-scheme:light] placeholder:text-[#8f8679] focus:border-[#7f1835] focus:outline-none';
const required = <span className="text-[#7f1835]"> *</span>;

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
  const time = text('visitTime', 5).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const people = Number.parseInt(text('partySize', 3), 10);
  const partySize = people >= 1 && people <= 50 ? people : null;
  await db.insert(exhibitionRsvps).values({
    fullName,
    contact,
    phone: phone.ok ? phone.e164 : null,
    visitDate: day?.value ?? null,
    visitTime: time?.[0] ?? null,
    partySize,
  });

  // The registration is already saved; a failure here must not cost the visitor their thank-you.
  if (phone.ok) {
    const visitSlot = time ? `${Number(time[1]) % 12 || 12}:${time[2]} ${Number(time[1]) < 12 ? 'am' : 'pm'}` : '';
    const rsvp = { phone: phone.e164, name: fullName, visitDay: day?.label ?? '', visitSlot, partySize };
    await upsertLeadByPhone(phone.e164, (existing) => withExhibitionRsvp(existing, rsvp))
      .catch((error) => console.error('[exhb] follow-up not created', error));
  }
  redirect(THANK_YOU_ROUTE);
}

export default async function ExhibitionPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return <main className="[font-family:Helvetica,'Helvetica_Neue',Arial,sans-serif] flex-1 bg-white px-5 py-12 text-[#232323] sm:py-16">
    <div className="mx-auto w-full max-w-xl">
      <header className="text-center">
        <p className="text-3xl tracking-[0.12em] text-[#7f1835]">DEEPAM</p>
        <p className="mt-0.5 text-xs tracking-[0.2em] text-[#7f1835]">by ananta</p>
        <h1 className="mt-8 text-xl font-normal uppercase leading-tight tracking-[0.08em] sm:text-2xl">Celebrations of Deepam</h1>

        <div className="mt-8 grid grid-cols-2 gap-4 border-y border-black/15 py-6 text-left">
          <div>
            <p className="text-sm uppercase leading-snug tracking-[0.12em] text-[#5c5c5c]">Shubh</p>
            <p className="text-sm uppercase leading-snug tracking-[0.12em] text-[#5c5c5c]">Convention Centre, JP Nagar, Bengaluru</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tracking-wide">16 – 18</p>
            <p className="mt-1 text-sm uppercase tracking-[0.12em] text-[#5c5c5c]">October</p>
          </div>
        </div>

        <p className="mt-6 text-base leading-snug text-[#5c5c5c]">
          A <strong className="font-semibold text-[#232323]">three-day celebration</strong> of dressing for festivals, weddings &amp; everything in between
        </p>
        <p className="mt-3 text-base leading-snug text-[#5c5c5c]">
          <strong className="font-semibold text-[#232323]">Exclusive pieces</strong> created specially for our exhibitions
        </p>
        <p className="mt-3 text-sm uppercase tracking-[0.12em] text-[#7f1835]">
          <strong className="font-semibold">15%</strong> exhibition-exclusive benefit
        </p>

        <a href={MAP_LINK} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center justify-center gap-2 rounded-full border border-[#7f1835] px-6 py-3 text-sm font-medium uppercase tracking-[0.18em] text-[#7f1835] hover:bg-[#7f1835] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7f1835]">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
          Get directions
        </a>
      </header>

      <form action={register} className="mt-10 space-y-5 rounded-2xl border border-black/10 p-6 sm:p-8">
        <h2 className="text-xl tracking-wide">Plan your visit</h2>
        <label className={label}><span>Full name{required}</span><input name="fullName" type="text" required maxLength={120} autoComplete="name" className={input} /></label>
        <label className={label}><span>Contact number{required}</span><input name="contact" type="tel" required inputMode="tel" autoComplete="tel" maxLength={40} pattern="(?=(?:\D*\d){10,})[\d\s+\-()]+" title="Enter a phone number with at least 10 digits" className={input} /></label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className={label}>Date<select name="visitDate" defaultValue="" className={input}><option value="">Select a day</option>{DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
          <label className={label}>Time<input name="visitTime" type="time" className={input} /></label>
        </div>
        <label className={label}>Number of people<input name="partySize" type="number" inputMode="numeric" min={1} max={50} className={input} /></label>
        <div aria-hidden="true" className="hidden"><label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label></div>
        {params.error && <p role="alert" className="text-sm text-[#b42318]">Please enter your full name and a contact number with at least 10 digits.</p>}
        <button className="w-full rounded-full bg-[#7f1835] px-6 py-3.5 text-sm font-semibold uppercase tracking-[0.2em] text-white hover:bg-[#661229] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7f1835]">Submit</button>
      </form>
    </div>
  </main>;
}
