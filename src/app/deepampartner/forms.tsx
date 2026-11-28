'use client';

import { useActionState, useState } from 'react';
import { OCCASIONS, REFERRAL_BRANDS, REFERRAL_STORES } from '@/lib/partners/constants';
import { applyAction, referAction, type FormState } from './actions';
import { btn, errorText, input, label, select } from './styles';

const initial: FormState = { message: '', values: {}, attempt: 0 };
const required = <span aria-hidden="true" className="text-[#a12b2b]">*</span>;
const PHONE_PATTERN = '(?=(?:\\D*\\d){10,})[\\d\\s+\\-()]+';

/** Hidden from people; bots fill it. */
const Honeypot = () => <div aria-hidden="true" className="hidden"><label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label></div>;

function Message({ text }: { text: string }) {
  return text ? <p role="alert" className={`mb-[18px] ${errorText}`}>{text}</p> : null;
}

export function ApplicationForm({ categories }: { categories: string[] }) {
  const [state, action, pending] = useActionState(applyAction, initial);
  const v = state.values;
  // A new key per attempt re-mounts the fields with what was typed, after React resets the form.
  return (
    <form key={state.attempt} action={action} className="mx-auto max-w-[720px]">
      <fieldset className="mb-[30px]">
        <legend className="mb-5 text-[1.35em] font-semibold">Partner onboarding form</legend>
        <div className="grid gap-x-[26px] gap-y-[22px] min-[601px]:grid-cols-2">
          <div className="min-[601px]:col-span-2"><label htmlFor="p-name" className={label}>Full Name {required}</label>
            <input id="p-name" name="fullName" type="text" required maxLength={120} autoComplete="name" defaultValue={v.fullName} className={input} /></div>
          <div><label htmlFor="p-contact" className={label}>Contact Number {required}</label>
            <input id="p-contact" name="contact" type="tel" required autoComplete="tel" maxLength={40} pattern={PHONE_PATTERN} title="Enter a 10-digit mobile number" defaultValue={v.contact} className={input} /></div>
          <div><label htmlFor="p-email" className={label}>Email Address {required}</label>
            <input id="p-email" name="email" type="email" required autoComplete="email" maxLength={160} defaultValue={v.email} className={input} /></div>
          <div><label htmlFor="p-category" className={label}>Partner Category {required}</label>
            <select id="p-category" name="category" required defaultValue={v.category ?? ''} className={select}>
              <option value="" disabled>Please select</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select></div>
          <div><label htmlFor="p-city" className={label}>City {required}</label>
            <input id="p-city" name="city" type="text" required maxLength={80} autoComplete="address-level2" defaultValue={v.city} className={input} /></div>
        </div>
      </fieldset>
      <label className="mb-[26px] flex items-start gap-3">
        <input name="consent" type="checkbox" required defaultChecked={v.consent === 'on'} className="mt-1 size-4 shrink-0 accent-[#7f1835]" />
        <span>I hereby agree to the Ananta Partners programme terms, confirm the details above are correct, and consent to Ananta contacting me about my application. {required}</span>
      </label>
      <Honeypot />
      <Message text={state.message} />
      <div className="text-center"><button className={btn} disabled={pending}>{pending ? 'Submitting…' : 'Submit'}</button></div>
    </form>
  );
}

export function ReferralForm({ partner, today, lastDay }: { partner: string; today: string; lastDay: string }) {
  const [state, action, pending] = useActionState(referAction, initial);
  const v = state.values;
  return <ReferralFields key={state.attempt} action={action} pending={pending} message={state.message} v={v} partner={partner} today={today} lastDay={lastDay} />;
}

/** The fields, re-mounted per attempt with what was typed. The store list follows the brand picked first. */
function ReferralFields({ action, pending, message, v, partner, today, lastDay }: {
  action: (form: FormData) => void; pending: boolean; message: string; v: Record<string, string>; partner: string; today: string; lastDay: string;
}) {
  const [brand, setBrand] = useState(v.brand ?? '');
  const stores = REFERRAL_STORES.filter((s) => s.brand === brand);
  return (
    <form action={action} className="mx-auto max-w-[720px]">
      <input type="hidden" name="partner" value={partner} />
      <fieldset className="mb-[30px]">
        <legend className="mb-5 text-[1.35em] font-semibold">Book your visit</legend>
        <div className="grid gap-x-[26px] gap-y-[22px] min-[601px]:grid-cols-2">
          <div className="min-[601px]:col-span-2"><label htmlFor="r-brand" className={label}>Choose Brand {required}</label>
            <select id="r-brand" name="brand" required value={brand} onChange={(e) => setBrand(e.target.value)} className={select}>
              <option value="" disabled>Please select</option>
              {REFERRAL_BRANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select></div>
          <div className="min-[601px]:col-span-2"><label htmlFor="r-name" className={label}>Full Name {required}</label>
            <input id="r-name" name="fullName" type="text" required maxLength={120} autoComplete="name" defaultValue={v.fullName} className={input} /></div>
          <div><label htmlFor="r-contact" className={label}>Contact No. {required}</label>
            <input id="r-contact" name="contact" type="tel" required autoComplete="tel" maxLength={40} pattern={PHONE_PATTERN} title="Enter a 10-digit mobile number" defaultValue={v.contact} className={input} /></div>
          <div><label htmlFor="r-occasion" className={label}>Shopping Occasion {required}</label>
            <select id="r-occasion" name="occasion" required defaultValue={v.occasion ?? ''} className={select}>
              <option value="" disabled>Please select</option>
              {OCCASIONS.map((o) => <option key={o}>{o}</option>)}
            </select></div>
          <div><label htmlFor="r-store" className={label}>Preferred Store {required}</label>
            <select id="r-store" key={brand} name="store" required disabled={!brand} defaultValue={stores.some((s) => s.code === v.store) ? v.store : ''} className={select}>
              <option value="" disabled>{brand ? 'Please select' : 'Choose a brand first'}</option>
              {stores.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select></div>
          <div><label htmlFor="r-date" className={label}>Preferred Appointment Date {required}</label>
            <input id="r-date" name="appointmentDate" type="date" required min={today} max={lastDay} defaultValue={v.appointmentDate} className={input} /></div>
        </div>
      </fieldset>
      <label className="mb-[26px] flex items-start gap-3">
        <input name="consent" type="checkbox" required defaultChecked={v.consent === 'on'} className="mt-1 size-4 shrink-0 accent-[#7f1835]" />
        <span>I consent to be contacted by Ananta Partners and the brand I chose, by phone, SMS or WhatsApp, about my visit. {required}</span>
      </label>
      <Honeypot />
      <Message text={message} />
      <div className="text-center"><button className={btn} disabled={pending}>{pending ? 'Submitting…' : 'Submit'}</button></div>
    </form>
  );
}

/** Copies a link; shows the link itself so it can also be selected by hand. */
export function CopyLink({ url }: { url: string }) {
  const copy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy link'; }, 2000);
    } catch {
      // Clipboard can be blocked; the link is on screen to copy by hand.
    }
  };
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <code className="min-w-0 flex-1 break-all border border-[#bfbfbf] bg-white px-4 py-3 text-left text-sm">{url}</code>
      <button type="button" onClick={copy} className={btn} aria-live="polite">Copy link</button>
    </div>
  );
}
