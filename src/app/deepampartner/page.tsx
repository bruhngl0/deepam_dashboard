import type { Metadata } from 'next';
import { activeCategoryNames } from '@/lib/partners/rules';
import { ApplicationForm } from './forms';
import { frame, heading, kicker, page, tile } from './styles';

const STEPS: [string, string][] = [
  ['Apply', 'Fill in the short form below. It takes a minute.'],
  ['Get approved', 'Our team reviews your application and collects a few documents.'],
  ['Share and earn', 'Share your own referral link and earn on every purchase your clients make.'],
];

export const metadata: Metadata = {
  title: 'Become an Ananta Partner',
  description: 'Apply to Ananta Partners: refer your clients and community to Deepam and Kalaniketan and earn on every purchase.',
  robots: { index: true, follow: true },
};

/** Public partner application. Approved partners get a Partner ID, a referral link and a dashboard. */
export const dynamic = 'force-dynamic';

export default async function PartnerApplicationPage() {
  const categories = await activeCategoryNames();
  return (
    <main className={page}>
      <div className="mx-auto mb-10 max-w-[720px] text-center">
        <p className={`${kicker} mb-3`}>Partner Programme</p>
        <h1 className={`${heading} mb-4`}><strong className="font-bold">Ananta</strong> Partners</h1>
        <p className="mb-[1em]">Makeup artists, stylists, photographers, wedding professionals and venues, influencers, community partners, our loyal customers and former colleagues: refer the people you work with to Deepam and Kalaniketan and earn on every purchase they make.</p>
        <p>Once your application is approved, we collect a few documents, then send you your Ananta Partner ID, your own referral link and a dashboard to follow your referrals.</p>
      </div>
      <ol className="mx-auto mb-10 grid max-w-[960px] gap-3 sm:grid-cols-3">
        {STEPS.map(([title, text], i) => (
          <li key={title} className={`${tile} px-5 py-5 text-center`}>
            <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-full border border-[#7f1835]/30 text-sm font-semibold text-[#7f1835]">{i + 1}</span>
            <p className="font-semibold">{title}</p>
            <p className="mt-1 text-[#5c5c5c]">{text}</p>
          </li>
        ))}
      </ol>
      <div className={`${frame} mx-auto max-w-[800px]`}>
        <ApplicationForm categories={categories} />
      </div>
    </main>
  );
}
