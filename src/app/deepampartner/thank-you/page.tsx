import type { Metadata } from 'next';
import { frame, heading, page } from '../styles';

export const metadata: Metadata = { title: 'Thank you · Ananta Partners' };

export default async function ApplicationThankYouPage({ searchParams }: { searchParams: Promise<{ existing?: string }> }) {
  const { existing } = await searchParams;
  return (
    <main className={page}>
      <div className={`${frame} mx-auto max-w-[720px] text-center`}>
        <span aria-hidden="true" className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full border border-[#7f1835]/25 bg-[#faf6ef] text-[#7f1835]"><svg viewBox="0 0 24 24" className="size-6 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"><path d="m5.5 12.5 4 4 9-9" /></svg></span>
        <h1 className={`${heading} mb-3`}><strong className="font-bold">Thank you</strong></h1>
        {existing
          ? <p className="mb-[1em]">We already have an application from this contact number. Our team will be in touch with you about it.</p>
          : <p className="mb-[1em]">Your application to Ananta Partners is received. Our team will review it and contact you about the next steps.</p>}
      </div>
    </main>
  );
}
