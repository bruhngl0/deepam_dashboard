import type { Metadata } from 'next';
import { heading, page } from '../styles';

export const metadata: Metadata = { title: 'Thank you · Deepam Partners' };

export default async function ApplicationThankYouPage({ searchParams }: { searchParams: Promise<{ existing?: string }> }) {
  const { existing } = await searchParams;
  return (
    <main className={page}>
      <div className="mx-auto max-w-[720px] text-center">
        <h1 className={`${heading} mb-3`}><strong className="font-bold">Thank you</strong></h1>
        {existing
          ? <p className="mb-[1em]">We already have an application from this contact number. Our team will be in touch with you about it.</p>
          : <p className="mb-[1em]">Your application to the Deepam Partner Programme is received. Our team will review it and contact you about the next steps.</p>}
      </div>
    </main>
  );
}
