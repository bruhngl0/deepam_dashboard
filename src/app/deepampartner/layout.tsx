import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';

// Same face and weights as the forms on deepam.com.
const montserrat = Montserrat({ subsets: ['latin'], weight: ['200', '300', '600', '700'] });

export const metadata: Metadata = {
  title: 'Ananta Partners',
  // Referral and dashboard links are personal; only the application page is meant to be found.
  robots: { index: false, follow: false },
};

/** Public Ananta Partners pages (Deepam and Kalaniketan): the application, customer registration on a referral link, and the partner dashboard. */
export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${montserrat.className} flex flex-1 flex-col bg-white text-sm font-light leading-[1.6] text-black antialiased [color-scheme:light]`}>
      {/* Wordmark, not a brand logo: the network covers Deepam and Kalaniketan. */}
      <div className="px-4 pt-9 text-center sm:px-[30px] md:pt-14">
        <p className="text-[1.05rem] font-semibold uppercase tracking-[0.32em] text-[#7f1835]">Ananta Partners</p>
      </div>
      {children}
    </div>
  );
}
