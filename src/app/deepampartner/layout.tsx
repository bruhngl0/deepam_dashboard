import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Montserrat } from 'next/font/google';
import { partnerPath } from '@/lib/partners/site';

// Same face and weights as the forms on deepam.com.
const montserrat = Montserrat({ subsets: ['latin'], weight: ['200', '300', '600', '700'] });

export const metadata: Metadata = {
  title: 'Deepam Partners',
  icons: { icon: '/deepam-logo.png' },
  // Referral and dashboard links are personal; only the application page is meant to be found.
  robots: { index: false, follow: false },
};

/** Public Deepam Partner pages: the application, customer registration on a referral link, and the partner dashboard. */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const [home, rules] = await Promise.all([partnerPath('/'), partnerPath('/rules')]);
  const nav = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5c5c5c] transition-colors hover:text-[#7f1835]';
  return (
    <div className={`${montserrat.className} flex flex-1 flex-col bg-white text-sm font-light leading-[1.6] text-black antialiased [color-scheme:light]`}>
      <div className="px-4 pt-9 text-center sm:px-[30px] md:pt-14">
        <Link href={home} aria-label="Deepam Partners home">
          <Image src="/deepam-logo.png" alt="Deepam by Ananta" width={310} height={119} unoptimized priority className="mx-auto h-auto w-[170px]" />
        </Link>
        <nav aria-label="Deepam Partners" className="mt-5 flex justify-center gap-6">
          <Link href={home} className={nav}>Become a partner</Link>
          <Link href={rules} className={nav}>Programme rules</Link>
        </nav>
      </div>
      {children}
      <footer className="mt-auto border-t border-[#efe7da] px-4 py-6 text-center text-xs text-[#8a8a8a]">
        © {new Date().getFullYear()} Deepam by Ananta · <a href="https://deepam.com" className="underline-offset-2 hover:underline">deepam.com</a>
      </footer>
    </div>
  );
}
