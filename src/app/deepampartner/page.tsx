import type { Metadata } from 'next';
import { ApplicationForm } from './forms';
import { heading, page } from './styles';

export const metadata: Metadata = {
  title: 'Become a Deepam Partner',
  description: 'Apply to the Deepam Partner Programme: refer your clients and community to Deepam and earn on every purchase.',
  robots: { index: true, follow: true },
};

/** Public partner application. Approved partners get a Partner ID, a referral link and a dashboard. */
export default function PartnerApplicationPage() {
  return (
    <main className={page}>
      <div className="mx-auto mb-9 max-w-[720px] text-center">
        <h1 className={`${heading} mb-4`}><strong className="font-bold">Deepam</strong> Partners</h1>
        <p className="mb-[1em]">Makeup artists, stylists, photographers, wedding professionals and venues, influencers, community partners, our loyal customers and former colleagues: refer the people you work with to Deepam and earn on every purchase they make.</p>
        <p>Once your application is approved, we collect a few documents, then send you your Deepam Partner ID, your own referral link and a dashboard to follow your referrals.</p>
      </div>
      <ApplicationForm />
    </main>
  );
}
