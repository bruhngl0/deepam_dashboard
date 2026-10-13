import { Montserrat } from 'next/font/google';

// Same face and weights as the forms on deepam.com.
const montserrat = Montserrat({ subsets: ['latin'], weight: ['200', '300', '600', '700'] });

export default function ExhibitionLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${montserrat.className} flex flex-1 flex-col bg-white text-sm font-light leading-[1.6] text-black antialiased [color-scheme:light]`}>{children}</div>;
}
