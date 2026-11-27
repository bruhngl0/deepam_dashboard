import type { Metadata } from 'next';
import Image from 'next/image';
import { Montserrat } from 'next/font/google';

// Same face and weights as the forms on deepam.com.
const montserrat = Montserrat({ subsets: ['latin'], weight: ['200', '300', '600', '700'] });

export const metadata: Metadata = {
  title: 'Deepam Partners',
  // Referral and dashboard links are personal; only the application page is meant to be found.
  robots: { index: false, follow: false },
};

/** Public Deepam Partner pages: the application, customer registration on a referral link, and the partner dashboard. */
export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${montserrat.className} flex flex-1 flex-col bg-white text-sm font-light leading-[1.6] text-black antialiased [color-scheme:light]`}>
      <div className="px-4 pt-9 text-center sm:px-[30px] md:pt-14">
        <Image src="/deepam-logo.png" alt="Deepam by Ananta" width={310} height={119} unoptimized priority className="mx-auto h-auto w-[170px]" />
      </div>
      {children}
    </div>
  );
}
