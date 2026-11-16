import type { Metadata } from 'next';
import { heading, page } from '../../styles';

export const metadata: Metadata = { title: 'Thank you · Deepam' };

export default function ReferralThankYouPage() {
  return (
    <main className={page}>
      <div className="mx-auto max-w-[720px] text-center">
        <h1 className={`${heading} mb-3`}><strong className="font-bold">Thank you</strong></h1>
        <p className="mb-[1em]">Your visit request is received. Our team will call you shortly to confirm your appointment.</p>
        <p>We look forward to welcoming you at Deepam.</p>
      </div>
    </main>
  );
}
