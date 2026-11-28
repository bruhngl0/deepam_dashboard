import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ananta Partners',
  // Referral and dashboard links are personal; only the application page is meant to be found.
  robots: { index: false, follow: false },
};

/** Public Ananta Partners pages (Deepam and Kalaniketan): the application, customer registration on a referral link, and the partner dashboard. */
export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col text-sm text-ink-2 antialiased">
      {/* Wordmark, not a brand logo: the network covers Deepam and Kalaniketan. */}
      <div className="px-4 pt-8 text-center">
        <p className="inline-flex items-center gap-2 text-base font-semibold text-ink">
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">A</span>
          Ananta Partners
        </p>
      </div>
      {children}
    </div>
  );
}
