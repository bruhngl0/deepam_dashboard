import type { Metadata } from 'next';
import Image from 'next/image';
import { btn, heading } from '../styles';

export const metadata: Metadata = {
  title: 'Thank you · Celebrations of Deepam',
  description: 'Your visit to Celebrations of Deepam is registered.',
};

const MAP_LINK = 'https://maps.app.goo.gl/eabDBEZHVUNxALJi8';

export default function ExhibitionThankYouPage() {
  return <main className="px-4 pb-14 pt-9 sm:px-[30px] md:pb-20 md:pt-14">
    <div className="mx-auto max-w-[720px] text-center">
      <Image src="/deepam-logo.png" alt="Deepam by Ananta" width={310} height={119} unoptimized priority className="mx-auto mb-6 h-auto w-[190px]" />
      <h1 className={`${heading} mb-3`}><strong className="font-bold">Thank you</strong></h1>
      <p className="mb-[1em]">Your visit is registered. We look forward to welcoming you at Celebrations of Deepam.</p>
      <p className="mb-[1.5em]">Shubh Convention Centre, JP Nagar, Bengaluru · 16 – 18 October</p>
      <a href={MAP_LINK} target="_blank" rel="noopener noreferrer" className={btn}>Get directions</a>
    </div>
  </main>;
}
